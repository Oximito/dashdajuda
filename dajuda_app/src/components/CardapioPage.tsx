import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { PlusCircle, Save, XCircle, Trash2, Edit3, AlertTriangle, Loader2 } from 'lucide-react';
import type { RealtimeChannel, RealtimePostgresChangesPayload, RealtimeChannelSendResponse } from "@supabase/supabase-js";

// Interface para o item do cardápio
export interface CardapioItem {
  id: number;
  categoria: string;
  disponivel: "Sim" | "Não";
  nome_produto: string;
  descricao_produto: string;
  observacao: string;
  promocoes?: string;
  isEditing?: boolean;
  originalNome?: string;
  originalCategoria?: string;
  originalDisponivel?: "Sim" | "Não";
  originalDescricao?: string;
  originalObservacao?: string;
  originalPromocoes?: string;
}

// Lista fixa de categorias
const categoriasDefinidas = [
  "Marmita do Dia",
  "Marmita Clássica",
  "Mix de Salada",
  "Bebida",
  "Adicional",
  "Unidade",
];

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 5000; // 5 segundos

// Função auxiliar para mapear dados do Supabase para o formato do estado
const mapSupabaseItemToState = (item: any): CardapioItem => ({
  ...item,
  id: item.id || 0,
  nome_produto: item.nome_produto || '',
  categoria: item.categoria || '',
  disponivel: item.disponivel === 'Sim' || item.disponivel === true ? 'Sim' : 'Não',
  descricao_produto: item.descricao_produto || '',
  observacao: item.observacao || '',
  promocoes: item.promocoes || '',
});

const CardapioPage: React.FC = () => {
  const [itensCardapio, setItensCardapio] = useState<CardapioItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState<boolean>(false);
  const [itemToDelete, setItemToDelete] = useState<CardapioItem | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const cardapioChannelRef = useRef<RealtimeChannel | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<number>(0);

  // Estado inicial para o formulário de novo item
  const [novoItem, setNovoItem] = useState<Omit<CardapioItem, 'id' | 'isEditing' | 'originalNome' | 'originalCategoria' | 'originalDisponivel' | 'originalDescricao' | 'originalObservacao' | 'originalPromocoes'>>({
    nome_produto: '',
    categoria: categoriasDefinidas[0],
    disponivel: "Sim",
    descricao_produto: '',
    observacao: '',
    promocoes: '',
  });

  // Função para buscar itens do cardápio (usada apenas na carga inicial)
  const fetchItensCardapio = useCallback(async (source?: string) => {
    console.log(`[CardapioPage] Buscando itens do cardápio... (Origem: ${source || 'desconhecida'})`);
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('Cárdapio')
      .select('*, promocoes')
      .order('nome_produto', { ascending: true });

    if (fetchError) {
      console.error('[CardapioPage] Erro ao buscar itens do cardápio:', fetchError);
      setError(`Falha ao carregar cardápio: ${fetchError.message}`);
      setItensCardapio([]); // Limpa em caso de erro
    } else {
      const mappedData = data.map(mapSupabaseItemToState);
      setItensCardapio(mappedData);
      setError(null);
    }
    setLoading(false);
  }, []);

  // Função para configurar e inscrever no canal Realtime
  const setupRealtimeSubscription = useCallback(() => {
    if (cardapioChannelRef.current) {
      supabase.removeChannel(cardapioChannelRef.current).catch(console.error);
      cardapioChannelRef.current = null;
    }
    if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
    }

    console.log("[CardapioPage] Tentando conectar ao canal Realtime...");
    const channel = supabase.channel('cardapio_realtime_channel');

    // Handler para mudanças recebidas via Realtime
    const handleRealtimeChange = (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
        console.log("[CardapioPage] Mudança Realtime recebida:", payload);
        setItensCardapio(currentItems => {
            let updatedItems = [...currentItems];
            const recordId = payload.new?.id || payload.old?.id;

            switch (payload.eventType) {
                case 'INSERT':
                    // Adiciona o novo item se ele ainda não existir no estado
                    if (!updatedItems.some(item => item.id === recordId)) {
                        updatedItems.push(mapSupabaseItemToState(payload.new));
                        console.log(`[CardapioPage] Item ${recordId} inserido via Realtime.`);
                    }
                    break;
                case 'UPDATE':
                    updatedItems = updatedItems.map(item => {
                        if (item.id === recordId) {
                            // **Crucial:** Só atualiza se o item NÃO estiver em modo de edição localmente
                            if (!item.isEditing) {
                                console.log(`[CardapioPage] Item ${recordId} atualizado via Realtime (não estava em edição).`);
                                return mapSupabaseItemToState(payload.new);
                            } else {
                                console.log(`[CardapioPage] Item ${recordId} ignorado na atualização Realtime (está em edição local).`);
                                // Opcional: Poderia atualizar os campos 'original*' aqui se quisesse refletir a mudança externa
                                // return { ...item, originalNome: payload.new.nome_produto || '', ... };
                                return item; // Mantém o item local com as edições não salvas
                            }
                        }
                        return item;
                    });
                    break;
                case 'DELETE':
                    const deletedId = payload.old?.id;
                    if (deletedId) {
                        updatedItems = updatedItems.filter(item => item.id !== deletedId);
                        console.log(`[CardapioPage] Item ${deletedId} removido via Realtime.`);
                    }
                    break;
                default:
                    console.log("[CardapioPage] Evento Realtime não tratado:", payload.eventType);
            }
            // Reordena após qualquer mudança para manter a ordem alfabética por nome
            updatedItems.sort((a, b) => (a.nome_produto || '').localeCompare(b.nome_produto || ''));
            return updatedItems;
        });
    };

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'Cárdapio' },
      handleRealtimeChange
    ).subscribe((status: "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR", err?: Error) => {
      if (status === 'SUBSCRIBED') {
        console.log('[CardapioPage] Conectado ao canal Realtime!');
        setError(null);
        retryCountRef.current = 0;
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
        // Busca inicial após conectar para garantir sincronia, caso tenha perdido algo
        fetchItensCardapio('after subscribe');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.error(`[CardapioPage] Erro/Status no canal Realtime: ${status}`, err);
        setError(`Erro de conexão em tempo real (Cardápio): ${status} - ${err?.message || 'Tentando reconectar...'}`);
        cardapioChannelRef.current = null;

        if (retryCountRef.current < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCountRef.current);
          console.log(`[CardapioPage] Tentando reconectar em ${delay / 1000} segundos... (Tentativa ${retryCountRef.current + 1}/${MAX_RETRIES})`);
          retryTimeoutRef.current = setTimeout(() => {
            retryCountRef.current++;
            setupRealtimeSubscription();
          }, delay);
        } else {
          console.error("[CardapioPage] Máximo de tentativas de reconexão atingido.");
          setError("Falha ao reconectar ao serviço de atualizações em tempo real (Cardápio) após múltiplas tentativas. Atualize manualmente.");
        }
      }
    });

    cardapioChannelRef.current = channel;

  }, [fetchItensCardapio]); // Removido setupRealtimeSubscription da dependência para evitar loop

  // Efeito para buscar dados iniciais e configurar Realtime
  useEffect(() => {
    fetchItensCardapio('initial mount');
    setupRealtimeSubscription();

    return () => {
      console.log("[CardapioPage] Desmontando componente e removendo canal Realtime.");
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (cardapioChannelRef.current) {
        supabase.removeChannel(cardapioChannelRef.current)
          .then(status => console.log('[CardapioPage] Canal Realtime removido no cleanup, status:', status))
          .catch(console.error);
        cardapioChannelRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchItensCardapio]); // Apenas fetchItensCardapio como dependência inicial

  // --- Funções de manipulação de formulário e ações (adição, exclusão, edição) ---

  const handleNovoItemInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === "disponivel") {
      setNovoItem(prev => ({ ...prev, disponivel: value as "Sim" | "Não" }));
    } else {
      setNovoItem(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoItem.nome_produto.trim() || !novoItem.categoria.trim()) {
      alert('Nome do produto e categoria são obrigatórios e não podem estar vazios.');
      return;
    }
    setSaving(true);

    let novoId = 1;
    if (itensCardapio.length > 0) {
      novoId = Math.max(...itensCardapio.map(item => item.id)) + 1;
    }

    const itemParaSalvar = {
        id: novoId,
        nome_produto: novoItem.nome_produto.trim(),
        categoria: novoItem.categoria.trim(),
        disponivel: novoItem.disponivel,
        descricao_produto: novoItem.descricao_produto.trim() === '' ? null : novoItem.descricao_produto.trim(),
        observacao: novoItem.observacao.trim() === '' ? null : novoItem.observacao.trim(),
        promocoes: novoItem.promocoes?.trim() === '' ? null : novoItem.promocoes?.trim(),
    };

    const { error: insertError } = await supabase
      .from('Cárdapio')
      .insert([itemParaSalvar]);
    setSaving(false);
    if (insertError) {
      console.error('Erro ao adicionar novo item:', insertError);
      alert(`Erro ao salvar: ${insertError.message}`);
    } else {
      alert('Novo item adicionado com sucesso!');
      setIsAddModalOpen(false);
      setNovoItem({
        nome_produto: '',
        categoria: categoriasDefinidas[0],
        disponivel: "Sim",
        descricao_produto: '',
        observacao: '',
        promocoes: '',
      });
      // A atualização Realtime deve cuidar de adicionar o item à lista
    }
  };

  const openDeleteConfirmationModal = (item: CardapioItem) => {
    setItemToDelete(item);
    setIsConfirmDeleteModalOpen(true);
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete) return;
    setSaving(true);
    const { error: deleteError } = await supabase
      .from('Cárdapio')
      .delete()
      .match({ id: itemToDelete.id });
    setSaving(false);
    if (deleteError) {
      console.error('Erro ao remover item:', deleteError);
      alert(`Erro ao remover: ${deleteError.message}`);
    } else {
      alert(`Item "${itemToDelete.nome_produto}" removido com sucesso!`);
      setIsConfirmDeleteModalOpen(false);
      setItemToDelete(null);
      // A atualização Realtime deve cuidar de remover o item da lista
    }
  };

  // Função para entrar/sair do modo de edição
  const toggleEditMode = (itemId: number) => {
    setItensCardapio(prevItens =>
      prevItens.map(item => {
        if (item.id === itemId) {
          if (!item.isEditing) {
            // Entrando no modo de edição: salva o estado original
            return {
              ...item,
              isEditing: true,
              originalNome: item.nome_produto,
              originalCategoria: item.categoria,
              originalDisponivel: item.disponivel,
              originalDescricao: item.descricao_produto,
              originalObservacao: item.observacao,
              originalPromocoes: item.promocoes,
            };
          } else {
            // Saindo do modo de edição (cancelando): restaura o estado original
            return {
              ...item,
              isEditing: false,
              nome_produto: item.originalNome !== undefined ? item.originalNome : item.nome_produto,
              categoria: item.originalCategoria !== undefined ? item.originalCategoria : item.categoria,
              disponivel: item.originalDisponivel !== undefined ? item.originalDisponivel : item.disponivel,
              descricao_produto: item.originalDescricao !== undefined ? item.originalDescricao : item.descricao_produto,
              observacao: item.originalObservacao !== undefined ? item.originalObservacao : item.observacao,
              promocoes: item.originalPromocoes !== undefined ? item.originalPromocoes : item.promocoes,
            };
          }
        }
        return item; // Mantém outros itens como estão
      })
    );
  };

  // Função para lidar com mudanças nos inputs de edição
  const handleEditInputChange = (itemId: number, field: keyof Omit<CardapioItem, 'id'>, value: any) => {
    setItensCardapio(prevItens =>
      prevItens.map(item =>
        item.id === itemId ? { ...item, [field]: value } : item
      )
    );
  };

  // Calcula itens com alterações pendentes
  const itemsComAlteracoes = useMemo(() => {
    return itensCardapio.filter(item =>
      item.isEditing &&
      (item.nome_produto.trim() !== (item.originalNome || '').trim() ||
       item.categoria.trim() !== (item.originalCategoria || '').trim() ||
       item.disponivel !== item.originalDisponivel ||
       item.descricao_produto.trim() !== (item.originalDescricao || '').trim() ||
       item.observacao.trim() !== (item.originalObservacao || '').trim() ||
       (item.promocoes || '').trim() !== (item.originalPromocoes || '').trim())
    );
  }, [itensCardapio]);

  // Salva todas as alterações pendentes
  const handleSaveAllChanges = async () => {
    if (itemsComAlteracoes.length === 0) {
      alert("Nenhuma alteração para salvar.");
      return;
    }

    const itensParaSalvar = itemsComAlteracoes.filter(item => {
        if (!item.nome_produto.trim() || !item.categoria.trim()) {
            alert(`O item com ID ${item.id} (nome original: "${item.originalNome || 'Sem nome original'}") não pode ser salvo porque o nome do produto e a categoria são obrigatórios e não podem estar vazios.`);
            return false;
        }
        return true;
    });

    if (itensParaSalvar.length === 0) {
        setSaving(false);
        return;
    }

    setSaving(true);

    const updates = itensParaSalvar.map(item => {
      const { id, nome_produto, categoria, disponivel, descricao_produto, observacao, promocoes } = item;
      return supabase
        .from('Cárdapio')
        .update({
            nome_produto: nome_produto.trim(),
            categoria: categoria.trim(),
            disponivel,
            descricao_produto: descricao_produto.trim() === '' ? null : descricao_produto.trim(),
            observacao: observacao.trim() === '' ? null : observacao.trim(),
            promocoes: promocoes?.trim() === '' ? null : promocoes?.trim(),
        })
        .match({ id });
    });

    try {
      const results = await Promise.all(updates);
      const errors = results.filter(result => result.error);
      if (errors.length > 0) {
        console.error("Erros ao salvar alterações:", errors);
        alert(`Houve ${errors.length} erro(s) ao salvar. Verifique o console.`);
      } else {
        alert("Todas as alterações selecionadas foram salvas com sucesso!");
        // Desativa o modo de edição para os itens salvos e limpa o estado original
        setItensCardapio(prev => prev.map(i => {
            const savedItem = itensParaSalvar.find(altered => altered.id === i.id);
            if (savedItem) {
                return {...i, isEditing: false, originalNome: undefined, originalCategoria: undefined, originalDisponivel: undefined, originalDescricao: undefined, originalObservacao: undefined, originalPromocoes: undefined };
            }
            return i;
        }));
      }
    } catch (e) {
      console.error("Erro geral ao salvar alterações:", e);
      alert("Ocorreu um erro inesperado ao salvar as alterações.");
    }
    setSaving(false);
  };

  // --- Renderização do componente ---

  if (loading && itensCardapio.length === 0) {
    return <div className="text-center p-10"><Loader2 className="h-12 w-12 text-pink-500 animate-spin mx-auto" /><p className="text-xl text-gray-600 mt-4">Carregando cardápio...</p></div>;
  }

  if (error && !loading) {
    return <div className="text-center p-10"><AlertTriangle className="h-12 w-12 text-red-500 mx-auto" /><p className="text-xl text-red-600 bg-red-100 p-4 rounded-lg mt-4">{error}</p></div>;
  }

  // Agrupa itens por categoria para renderização
  const groupedItens = itensCardapio.reduce((acc, item) => {
    const categoriaKey = item.categoria.trim() || 'Sem Categoria';
    if (!acc[categoriaKey]) {
      acc[categoriaKey] = [];
    }
    acc[categoriaKey].push(item);
    return acc;
  }, {} as Record<string, CardapioItem[]>);

  const formFieldClasses = "block w-full p-2 border-2 border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 text-sm bg-white";

  return (
    <div className="container mx-auto p-4 pb-20">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-semibold text-gray-700">Itens do Cardápio</h2>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md flex items-center transition-colors duration-150"
        >
          <PlusCircle size={20} className="mr-2" />
          Adicionar Novo Item
        </button>
      </div>

      {itemsComAlteracoes.length > 0 && (
        <div className="fixed bottom-6 right-6 z-40">
            <button
                onClick={handleSaveAllChanges}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-xl flex items-center text-lg transition-all duration-150 ease-in-out transform hover:scale-105"
            >
                {saving ? <Loader2 size={24} className="animate-spin mr-2" /> : <Save size={24} className="mr-2" />}
                {saving ? 'Salvando...' : `Salvar ${itemsComAlteracoes.length} Alterações`}
            </button>
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-semibold mb-6 text-gray-800">Adicionar Novo Item ao Cardápio</h3>
            <form onSubmit={handleAddNewItem}>
              <div className="mb-4">
                <label htmlFor="nome_produto_novo" className="block text-sm font-medium text-gray-700 mb-1">Nome do Produto</label>
                <input type="text" name="nome_produto" id="nome_produto_novo" value={novoItem.nome_produto} onChange={handleNovoItemInputChange} required className={formFieldClasses} />
              </div>
              <div className="mb-4">
                <label htmlFor="categoria_novo" className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select name="categoria" id="categoria_novo" value={novoItem.categoria} onChange={handleNovoItemInputChange} required className={formFieldClasses}>
                  {categoriasDefinidas.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                </select>
              </div>
              <div className="mb-4">
                <label htmlFor="disponivel_novo" className="block text-sm font-medium text-gray-700 mb-1">Disponível</label>
                <select name="disponivel" id="disponivel_novo" value={novoItem.disponivel} onChange={handleNovoItemInputChange} required className={formFieldClasses}>
                  <option value="Sim">Sim</option>
                  <option value="Não">Não</option>
                </select>
              </div>
              <div className="mb-4">
                <label htmlFor="descricao_produto_novo" className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea name="descricao_produto" id="descricao_produto_novo" value={novoItem.descricao_produto} onChange={handleNovoItemInputChange} rows={3} className={formFieldClasses} />
              </div>
              <div className="mb-4">
                <label htmlFor="promocoes_novo" className="block text-sm font-medium text-gray-700 mb-1">Promoções</label>
                <textarea name="promocoes" id="promocoes_novo" value={novoItem.promocoes} onChange={handleNovoItemInputChange} rows={2} className={formFieldClasses} />
              </div>
              <div className="mb-6">
                <label htmlFor="observacao_novo" className="block text-sm font-medium text-gray-700 mb-1">Observação</label>
                <textarea name="observacao" id="observacao_novo" value={novoItem.observacao} onChange={handleNovoItemInputChange} rows={2} className={formFieldClasses} />
              </div>
              <div className="flex justify-end space-x-3">
                <button type="button" onClick={() => setIsAddModalOpen(false)} disabled={saving} className="btn-secondary">
                  <XCircle size={18} className="inline mr-1"/> Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary bg-green-500 hover:bg-green-600">
                  {saving ? <Loader2 size={18} className="inline mr-1 animate-spin"/> : <Save size={18} className="inline mr-1"/>}
                  {saving ? 'Salvando...' : 'Salvar Novo Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isConfirmDeleteModalOpen && itemToDelete && (
         <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">
            <div className="text-center">
                <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-3 text-gray-800">Confirmar Remoção</h3>
                <p className="text-gray-600 mb-6">
                  Você tem certeza que deseja remover o item "<strong>{itemToDelete.nome_produto || 'Item sem nome'}</strong>"?
                  <br/>Esta ação não poderá ser desfeita.
                </p>
            </div>
            <div className="flex justify-center space-x-4">
              <button onClick={() => setIsConfirmDeleteModalOpen(false)} disabled={saving} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={handleDeleteItem} disabled={saving} className="btn-danger">
                {saving ? <Loader2 size={18} className="inline mr-1 animate-spin"/> : <Trash2 size={18} className="inline mr-1"/>}
                {saving ? 'Removendo...' : 'Confirmar Remoção'}
              </button>
            </div>
          </div>
        </div>
      )}

      {itensCardapio.length === 0 && !loading && !error && (
        <div className="text-center text-gray-500 mt-12">
          <p className="text-2xl mb-2">Nenhum item no cardápio ainda.</p>
          <p className="text-lg">Clique em "Adicionar Novo Item" para começar.</p>
        </div>
      )}

      {categoriasDefinidas.map(categoriaNome => {
        const itensDaCategoria = (groupedItens[categoriaNome] || []).sort((a, b) => (a.nome_produto || '').localeCompare(b.nome_produto || ''));

        if (itensDaCategoria.length === 0) {
            return null;
        }

        return (
          <div key={categoriaNome} className="mb-8">
            <h3 className="text-2xl font-semibold text-pink-600 mb-4 border-b-2 border-pink-200 pb-2">{categoriaNome}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {itensDaCategoria.map(item => (
                <div key={item.id} className={`p-5 rounded-lg shadow-lg border ${item.isEditing ? 'border-pink-500 ring-2 ring-pink-300 bg-pink-50' : 'border-gray-200 bg-white'} transition-colors duration-150 ease-in-out`}>
                  {item.isEditing ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-0.5">Nome</label>
                        <input type="text" value={item.nome_produto} onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)} className={formFieldClasses} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-0.5">Categoria</label>
                        <select value={item.categoria} onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)} className={formFieldClasses}>
                          {categoriasDefinidas.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                           <option value="">Sem Categoria</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-0.5">Disponível</label>
                        <select value={item.disponivel} onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value as "Sim" | "Não")} className={`${formFieldClasses} ${item.disponivel === 'Sim' ? 'bg-green-50' : 'bg-red-50'}`}>
                          <option value="Sim">Sim</option>
                          <option value="Não">Não</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-0.5">Descrição</label>
                        <textarea value={item.descricao_produto} onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)} rows={2} className={formFieldClasses} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-0.5">Promoções</label>
                        <textarea value={item.promocoes || ''} onChange={(e) => handleEditInputChange(item.id, 'promocoes', e.target.value)} rows={2} className={formFieldClasses} />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-0.5">Observação</label>
                        <textarea value={item.observacao} onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)} rows={1} className={formFieldClasses} />
                      </div>
                      <div className="flex justify-end space-x-2 mt-3">
                        <button onClick={() => toggleEditMode(item.id)} className="btn-icon text-gray-600 hover:text-gray-800" title="Cancelar Edição">
                            <XCircle size={20}/>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col justify-between h-full">
                        <div>
                            <h4 className="text-xl font-semibold text-gray-800 mb-1">{item.nome_produto || "(Item sem nome)"}</h4>
                            <p className={`text-sm font-medium mb-2 px-2 py-0.5 inline-block rounded-full ${item.disponivel === 'Sim' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {item.disponivel === 'Sim' ? 'Disponível' : 'Indisponível'}
                            </p>
                            {item.descricao_produto && <p className="text-gray-600 text-sm mt-1 mb-3 leading-relaxed"><strong className="font-medium text-gray-700">Descrição:</strong> {item.descricao_produto}</p>}
                            {item.promocoes && (
                              <div className="mt-2 mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded-md">
                                <p className="text-yellow-700 text-sm"><strong className="font-medium text-yellow-800">Promoção:</strong> {item.promocoes}</p>
                              </div>
                            )}
                            {item.observacao && <p className="text-gray-500 text-xs mt-1"><strong>Obs:</strong> {item.observacao}</p>}
                        </div>
                        <div className="mt-4 pt-3 border-t border-gray-200 flex justify-end space-x-2">
                            <button onClick={() => toggleEditMode(item.id)} title="Editar Item" className="btn-icon text-blue-600 hover:text-blue-800">
                                <Edit3 size={18} />
                            </button>
                            <button onClick={() => openDeleteConfirmationModal(item)} title="Remover Item" className="btn-icon text-red-600 hover:text-red-800">
                                <Trash2 size={18} />
                            </button>
                        </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {(groupedItens['Sem Categoria'] && groupedItens['Sem Categoria'].length > 0) && (
          <div key="Sem Categoria" className="mb-8">
            <h3 className="text-2xl font-semibold text-gray-500 mb-4 border-b-2 border-gray-300 pb-2">Sem Categoria</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {(groupedItens['Sem Categoria'].sort((a, b) => (a.nome_produto || '').localeCompare(b.nome_produto || ''))).map(item => (
                <div key={item.id} className={`p-5 rounded-lg shadow-lg border ${item.isEditing ? 'border-pink-500 ring-2 ring-pink-300 bg-pink-50' : 'border-gray-200 bg-white'} transition-colors duration-150 ease-in-out`}>
                  {item.isEditing ? (
                    <div className="space-y-3">
                      <div><label className="block text-sm font-medium text-gray-700 mb-0.5">Nome</label><input type="text" value={item.nome_produto} onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)} className={formFieldClasses} /></div>
                      <div><label className="block text-sm font-medium text-gray-700 mb-0.5">Categoria</label><select value={item.categoria} onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)} className={formFieldClasses}>{categoriasDefinidas.map(cat => (<option key={cat} value={cat}>{cat}</option>))}<option value="">Sem Categoria</option></select></div>
                      <div><label className="block text-sm font-medium text-gray-700 mb-0.5">Disponível</label><select value={item.disponivel} onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value as "Sim" | "Não")} className={`${formFieldClasses} ${item.disponivel === 'Sim' ? 'bg-green-50' : 'bg-red-50'}`}><option value="Sim">Sim</option><option value="Não">Não</option></select></div>
                      <div><label className="block text-sm font-medium text-gray-700 mb-0.5">Descrição</label><textarea value={item.descricao_produto} onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)} rows={2} className={formFieldClasses} /></div>
                      <div><label className="block text-sm font-medium text-gray-700 mb-0.5">Promoções</label><textarea value={item.promocoes || ''} onChange={(e) => handleEditInputChange(item.id, 'promocoes', e.target.value)} rows={2} className={formFieldClasses} /></div>
                      <div><label className="block text-sm font-medium text-gray-700 mb-0.5">Observação</label><textarea value={item.observacao} onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)} rows={1} className={formFieldClasses} /></div>
                      <div className="flex justify-end space-x-2 mt-3"><button onClick={() => toggleEditMode(item.id)} className="btn-icon text-gray-600 hover:text-gray-800" title="Cancelar Edição"><XCircle size={20}/></button></div>
                    </div>
                  ) : (
                    <div className="flex flex-col justify-between h-full">
                      <div>
                        <h4 className="text-xl font-semibold text-gray-800 mb-1">{item.nome_produto || "(Item sem nome)"}</h4>
                        <p className={`text-sm font-medium mb-2 px-2 py-0.5 inline-block rounded-full ${item.disponivel === 'Sim' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{item.disponivel === 'Sim' ? 'Disponível' : 'Indisponível'}</p>
                        {item.descricao_produto && <p className="text-gray-600 text-sm mt-1 mb-3 leading-relaxed"><strong className="font-medium text-gray-700">Descrição:</strong> {item.descricao_produto}</p>}
                        {item.promocoes && <div className="mt-2 mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded-md"><p className="text-yellow-700 text-sm"><strong className="font-medium text-yellow-800">Promoção:</strong> {item.promocoes}</p></div>}
                        {item.observacao && <p className="text-gray-500 text-xs mt-1"><strong>Obs:</strong> {item.observacao}</p>}
                      </div>
                      <div className="mt-4 pt-3 border-t border-gray-200 flex justify-end space-x-2">
                        <button onClick={() => toggleEditMode(item.id)} title="Editar Item" className="btn-icon text-blue-600 hover:text-blue-800"><Edit3 size={18} /></button>
                        <button onClick={() => openDeleteConfirmationModal(item)} title="Remover Item" className="btn-icon text-red-600 hover:text-red-800"><Trash2 size={18} /></button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
      )}
    </div>
  );
};

export default CardapioPage;


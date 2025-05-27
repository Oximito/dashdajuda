import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { PlusCircle, Save, XCircle, Trash2, Edit3, AlertTriangle, Loader2 } from 'lucide-react';
// Removido import não utilizado de RealtimeChannelSendResponse
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

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

// Definindo um tipo mais específico para o payload, esperando que new/old sejam do tipo CardapioItem (ou parcial)
// Nota: O Supabase pode enviar outras propriedades, mas focamos nas que usamos.
type CardapioPayload = RealtimePostgresChangesPayload<Partial<CardapioItem> & { [key: string]: any }>;

// Função auxiliar para mapear dados do Supabase para o formato do estado
const mapSupabaseItemToState = (item: any): CardapioItem => ({
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

  const [novoItem, setNovoItem] = useState<Omit<CardapioItem, 'id' | 'isEditing' | 'originalNome' | 'originalCategoria' | 'originalDisponivel' | 'originalDescricao' | 'originalObservacao' | 'originalPromocoes'>>({
    nome_produto: '',
    categoria: categoriasDefinidas[0],
    disponivel: "Sim",
    descricao_produto: '',
    observacao: '',
    promocoes: '',
  });

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
      setItensCardapio([]);
    } else {
      const mappedData = data.map(mapSupabaseItemToState);
      setItensCardapio(mappedData);
      setError(null);
    }
    setLoading(false);
  }, []);

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

    // Handler com a tipagem corrigida para o payload
    const handleRealtimeChange = (payload: CardapioPayload) => {
        console.log("[CardapioPage] Mudança Realtime recebida:", payload);
        setItensCardapio(currentItems => {
            let updatedItems = [...currentItems];
            // Acessando 'id' de forma segura, sabendo que pode estar em 'new' ou 'old'
            const recordId = payload.new?.id ?? payload.old?.id;

            switch (payload.eventType) {
                case 'INSERT':
                    if (recordId && !updatedItems.some(item => item.id === recordId)) {
                        // Mapeia o novo item para garantir a estrutura correta
                        updatedItems.push(mapSupabaseItemToState(payload.new));
                        console.log(`[CardapioPage] Item ${recordId} inserido via Realtime.`);
                    }
                    break;
                case 'UPDATE':
                    if (recordId) {
                        updatedItems = updatedItems.map(item => {
                            if (item.id === recordId) {
                                if (!item.isEditing) {
                                    console.log(`[CardapioPage] Item ${recordId} atualizado via Realtime (não estava em edição).`);
                                    // Mapeia o item atualizado
                                    return mapSupabaseItemToState(payload.new);
                                } else {
                                    console.log(`[CardapioPage] Item ${recordId} ignorado na atualização Realtime (está em edição local).`);
                                    return item;
                                }
                            }
                            return item;
                        });
                    }
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

  }, [fetchItensCardapio]);

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
  }, [fetchItensCardapio]);

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
    }
  };

  const toggleEditMode = (itemId: number) => {
    setItensCardapio(prevItens =>
      prevItens.map(item => {
        if (item.id === itemId) {
          if (!item.isEditing) {
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
        return item;
      })
    );
  };

  const handleEditInputChange = (itemId: number, field: keyof Omit<CardapioItem, 'id'>, value: any) => {
    setItensCardapio(prevItens =>
      prevItens.map(item =>
        item.id === itemId ? { ...item, [field]: value } : item
      )
    );
  };

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

    const results = await Promise.all(updates);
    setSaving(false);

    const erros = results.filter(result => result.error);

    if (erros.length > 0) {
      console.error("Erros ao salvar alterações:", erros);
      alert(`Houve ${erros.length} erro(s) ao salvar. Verifique o console.`);
    } else {
      alert("Todas as alterações foram salvas com sucesso!");
      // Sai do modo de edição para os itens salvos
      setItensCardapio(prevItens =>
        prevItens.map(item =>
          itensParaSalvar.some(savedItem => savedItem.id === item.id)
            ? { ...item, isEditing: false, originalNome: undefined, originalCategoria: undefined, originalDisponivel: undefined, originalDescricao: undefined, originalObservacao: undefined, originalPromocoes: undefined }
            : item
        )
      );
    }
  };

  // Agrupa itens por categoria para renderização
  const itensAgrupados = useMemo(() => {
    const grupos: { [key: string]: CardapioItem[] } = {};
    categoriasDefinidas.forEach(cat => grupos[cat] = []); // Inicializa todas as categorias definidas

    itensCardapio.forEach(item => {
      const categoria = item.categoria || "Sem Categoria";
      if (!grupos[categoria]) {
        grupos[categoria] = [];
      }
      grupos[categoria].push(item);
    });

    // Ordena os itens dentro de cada categoria alfabeticamente pelo nome
    Object.keys(grupos).forEach(categoria => {
      grupos[categoria].sort((a, b) => (a.nome_produto || '').localeCompare(b.nome_produto || ''));
    });

    return grupos;
  }, [itensCardapio]);

  // Estilos comuns para inputs
  const inputStyle = "mt-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-md text-sm shadow-sm placeholder-gray-400 focus:outline-none focus:border-pink-500 focus:ring-1 focus:ring-pink-500 disabled:bg-gray-50 disabled:text-gray-500 disabled:border-gray-200 disabled:shadow-none";
  const labelStyle = "block text-sm font-medium text-gray-700";

  return (
    <div className="container mx-auto px-4 py-8">
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
          <strong className="font-bold">Erro: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-semibold text-gray-800">Itens do Cardápio</h2>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="btn-primary bg-green-600 hover:bg-green-700"
        >
          <PlusCircle size={20} className="inline mr-2" /> Adicionar Novo Item
        </button>
      </div>

      {itemsComAlteracoes.length > 0 && (
        <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-6 rounded-md shadow-md flex justify-between items-center">
          <div>
            <p className="font-bold">Você tem {itemsComAlteracoes.length} item(ns) com alterações não salvas.</p>
            <p className="text-sm">Clique em "Salvar Alterações" para aplicá-las.</p>
          </div>
          <button
            onClick={handleSaveAllChanges}
            disabled={saving}
            className="btn-primary bg-blue-600 hover:bg-blue-700"
          >
            {saving ? <Loader2 size={20} className="inline mr-1 animate-spin" /> : <Save size={20} className="inline mr-1" />}
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-10">
          <Loader2 size={40} className="animate-spin text-pink-600 mx-auto" />
          <p className="mt-2 text-gray-600">Carregando cardápio...</p>
        </div>
      ) : (
        <div className="space-y-10">
          {categoriasDefinidas.map(categoria => (
            (itensAgrupados[categoria]?.length > 0 || categoria === "Sem Categoria") && (
              <div key={categoria}>
                <h3 className="text-2xl font-semibold text-gray-700 mb-4 border-b-2 border-pink-300 pb-2">{categoria}</h3>
                {itensAgrupados[categoria]?.length === 0 && categoria !== "Sem Categoria" && (
                    <p className="text-gray-500 italic">Nenhum item nesta categoria.</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {itensAgrupados[categoria]?.map(item => (
                    <div key={item.id} className={`bg-white rounded-lg shadow-lg p-5 border-l-4 ${item.disponivel === 'Sim' ? 'border-green-500' : 'border-red-500'} ${item.isEditing ? 'ring-2 ring-pink-500 ring-offset-2' : ''}`}>
                      {item.isEditing ? (
                        // Formulário de Edição Inline
                        <div className="space-y-3">
                          <div>
                            <label htmlFor={`nome-${item.id}`} className={labelStyle}>Nome</label>
                            <input
                              id={`nome-${item.id}`}
                              type="text"
                              value={item.nome_produto}
                              onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)}
                              className={inputStyle}
                              required
                            />
                          </div>
                          <div>
                            <label htmlFor={`categoria-${item.id}`} className={labelStyle}>Categoria</label>
                            <select
                              id={`categoria-${item.id}`}
                              value={item.categoria}
                              onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)}
                              className={inputStyle}
                              required
                            >
                              {categoriasDefinidas.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                              {/* Permite categorias não definidas, se existirem */}
                              {!categoriasDefinidas.includes(item.categoria) && item.categoria && (
                                <option value={item.categoria}>{item.categoria} (Outra)</option>
                              )}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`disponivel-${item.id}`} className={labelStyle}>Disponível</label>
                            <select
                              id={`disponivel-${item.id}`}
                              value={item.disponivel}
                              onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value as "Sim" | "Não")}
                              className={inputStyle}
                            >
                              <option value="Sim">Sim</option>
                              <option value="Não">Não</option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`descricao-${item.id}`} className={labelStyle}>Descrição</label>
                            <textarea
                              id={`descricao-${item.id}`}
                              value={item.descricao_produto}
                              onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)}
                              rows={3}
                              className={inputStyle}
                            />
                          </div>
                          <div>
                            <label htmlFor={`promocoes-${item.id}`} className={labelStyle}>Promoções</label>
                            <textarea
                              id={`promocoes-${item.id}`}
                              value={item.promocoes || ''}
                              onChange={(e) => handleEditInputChange(item.id, 'promocoes', e.target.value)}
                              rows={2}
                              className={inputStyle}
                              placeholder="Ex: Leve 3 Pague 2"
                            />
                          </div>
                          <div>
                            <label htmlFor={`observacao-${item.id}`} className={labelStyle}>Observação Interna</label>
                            <textarea
                              id={`observacao-${item.id}`}
                              value={item.observacao}
                              onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)}
                              rows={2}
                              className={inputStyle}
                              placeholder="Ex: Contém glúten"
                            />
                          </div>
                          <div className="flex justify-end space-x-2 pt-3">
                            <button onClick={() => toggleEditMode(item.id)} className="btn-secondary text-sm">
                              <XCircle size={16} className="inline mr-1" /> Cancelar
                            </button>
                            {/* O botão de salvar é global agora */}
                          </div>
                        </div>
                      ) : (
                        // Visualização Normal
                        <div className="flex flex-col h-full">
                          <div className="flex-grow">
                            <h4 className="text-xl font-bold text-gray-800 mb-1">{item.nome_produto || "(Item sem nome)"}</h4>
                            <p className="text-sm text-gray-600 mb-3">
                              <span className={`font-medium ${item.disponivel === 'Sim' ? 'text-green-600' : 'text-red-600'}`}>
                                {item.disponivel === 'Sim' ? 'Disponível' : 'Indisponível'}
                              </span>
                            </p>
                            {item.descricao_produto && <p className="text-gray-700 text-sm mb-2">{item.descricao_produto}</p>}
                            {item.promocoes && (
                                <div className="mt-2 p-2 bg-yellow-100 border border-yellow-300 rounded">
                                    <p className="text-sm font-semibold text-yellow-800">Promoção:</p>
                                    <p className="text-sm text-yellow-700">{item.promocoes}</p>
                                </div>
                            )}
                            {item.observacao && <p className="text-xs text-gray-500 mt-2 italic">Obs: {item.observacao}</p>}
                          </div>
                          <div className="mt-4 pt-4 border-t border-gray-200 flex justify-end space-x-2">
                            <button
                              onClick={() => toggleEditMode(item.id)}
                              className="btn-secondary text-sm"
                              title="Editar Item"
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              onClick={() => openDeleteConfirmationModal(item)}
                              className="btn-danger text-sm"
                              title="Excluir Item"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      )}

      {/* Modal de Adicionar Novo Item */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-semibold mb-6 text-gray-800">Adicionar Novo Item ao Cardápio</h3>
            <form onSubmit={handleAddNewItem} className="space-y-4">
              <div>
                <label htmlFor="novo-nome" className={labelStyle}>Nome do Produto*</label>
                <input
                  id="novo-nome"
                  type="text"
                  name="nome_produto"
                  value={novoItem.nome_produto}
                  onChange={handleNovoItemInputChange}
                  className={inputStyle}
                  required
                />
              </div>
              <div>
                <label htmlFor="novo-categoria" className={labelStyle}>Categoria*</label>
                <select
                  id="novo-categoria"
                  name="categoria"
                  value={novoItem.categoria}
                  onChange={handleNovoItemInputChange}
                  className={inputStyle}
                  required
                >
                  {categoriasDefinidas.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="novo-disponivel" className={labelStyle}>Disponível*</label>
                <select
                  id="novo-disponivel"
                  name="disponivel"
                  value={novoItem.disponivel}
                  onChange={handleNovoItemInputChange}
                  className={inputStyle}
                >
                  <option value="Sim">Sim</option>
                  <option value="Não">Não</option>
                </select>
              </div>
              <div>
                <label htmlFor="novo-descricao" className={labelStyle}>Descrição</label>
                <textarea
                  id="novo-descricao"
                  name="descricao_produto"
                  value={novoItem.descricao_produto}
                  onChange={handleNovoItemInputChange}
                  rows={3}
                  className={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="novo-promocoes" className={labelStyle}>Promoções</label>
                <textarea
                  id="novo-promocoes"
                  name="promocoes"
                  value={novoItem.promocoes || ''}
                  onChange={handleNovoItemInputChange}
                  rows={2}
                  className={inputStyle}
                  placeholder="Ex: Leve 3 Pague 2"
                />
              </div>
              <div>
                <label htmlFor="novo-observacao" className={labelStyle}>Observação Interna</label>
                <textarea
                  id="novo-observacao"
                  name="observacao"
                  value={novoItem.observacao}
                  onChange={handleNovoItemInputChange}
                  rows={2}
                  className={inputStyle}
                  placeholder="Ex: Contém glúten"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setIsAddModalOpen(false)} disabled={saving} className="btn-secondary">
                  <XCircle size={18} className="inline mr-1" /> Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary bg-green-600 hover:bg-green-700">
                  {saving ? <Loader2 size={18} className="inline mr-1 animate-spin" /> : <PlusCircle size={18} className="inline mr-1" />}
                  {saving ? 'Salvando...' : 'Adicionar Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão */}
      {isConfirmDeleteModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">
            <div className="text-center">
              <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
              <h3 className="text-xl font-semibold mb-3 text-gray-800">Confirmar Exclusão</h3>
              <p className="text-gray-600 mb-6">
                Você tem certeza que deseja excluir o item "<strong>{itemToDelete?.nome_produto || 'este item'}</strong>"?
                <br />Esta ação não poderá ser desfeita.
              </p>
            </div>
            <div className="flex justify-center space-x-4">
              <button onClick={() => setIsConfirmDeleteModalOpen(false)} disabled={saving} className="btn-secondary">
                Cancelar
              </button>
              <button onClick={handleDeleteItem} disabled={saving} className="btn-danger">
                {saving ? <Loader2 size={18} className="inline mr-1 animate-spin" /> : <Trash2 size={18} className="inline mr-1" />}
                {saving ? 'Excluindo...' : 'Excluir Item'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CardapioPage;


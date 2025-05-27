import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { PlusCircle, Save, XCircle, Trash2, Edit3, AlertTriangle, Loader2 } from 'lucide-react';
import type { RealtimeChannel } from "@supabase/supabase-js";

// Interface para o item do cardápio
export interface CardapioItem {
  id: number;
  categoria: string;
  disponivel: 'Sim' | 'Não';
  nome_produto: string;
  descricao_produto?: string | null;
  observacao?: string | null;
  promocoes?: string | null;
  isEditing?: boolean;
  originalNome?: string;
  originalCategoria?: string;
  originalDisponivel?: 'Sim' | 'Não';
  originalDescricao?: string | null;
  originalObservacao?: string | null;
  originalPromocoes?: string | null;
}

// Ordem correta das categorias - CORRIGIDA
const categoriasOrdenadas = [
  "Marmita do dia",
  "Marmita clássica",
  "Mix de salada",
  "Bebida", // Ajustado para singular se necessário, ou manter como no DB
  "Adicional", // Ajustado para singular se necessário, ou manter como no DB
  "Unidade", // Ajustado para singular se necessário, ou manter como no DB
];

const CardapioPage: React.FC = () => {
  const [itensCardapio, setItensCardapio] = useState<CardapioItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState<boolean>(false);
  const [itemToDelete, setItemToDelete] = useState<CardapioItem | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const cardapioChannelRef = useRef<RealtimeChannel | null>(null);
  const [reconnecting, setReconnecting] = useState<boolean>(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 5000;

  // Estado para o novo item
  const [novoItem, setNovoItem] = useState<Partial<Omit<CardapioItem, 'id'>>>({ 
    nome_produto: '',
    categoria: categoriasOrdenadas[0], // Inicia com a primeira categoria correta
    disponivel: 'Sim',
    descricao_produto: '',
    observacao: '',
    promocoes: '',
  });

  // Função para buscar itens do cardápio
  const fetchItensCardapio = useCallback(async (source?: string) => {
    console.log(`Buscando itens do cardápio... (Origem: ${source || 'desconhecida'})`);
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('Cárdapio') // Atenção ao nome da tabela, confirmar se é 'Cárdapio' ou 'Cardapio'
      .select('*');

    if (fetchError) {
      console.error('Erro ao buscar itens do cardápio:', fetchError);
      setError(`Falha ao carregar cardápio: ${fetchError.message}`);
    } else {
      const processedData = data.map(item => ({ 
        ...item,
        disponivel: item.disponivel === 'Sim' ? 'Sim' : 'Não',
        nome_produto: item.nome_produto || '',
        categoria: item.categoria || '',
        descricao_produto: item.descricao_produto || '',
        observacao: item.observacao || '',
        promocoes: item.promocoes || '',
      })) as CardapioItem[];
      
      // Ordenar alfabeticamente dentro das categorias será feito na renderização
      // processedData.sort((a, b) => a.nome_produto.localeCompare(b.nome_produto));
      
      setItensCardapio(processedData);
      setError(null);
    }
    setLoading(false);
  }, []);

  // Função para configurar o canal Realtime
  const setupRealtimeChannel = useCallback(() => {
    if (cardapioChannelRef.current) {
      supabase.removeChannel(cardapioChannelRef.current)
        .then(() => console.log('Canal Realtime (Cárdapio) removido antes de reconectar'))
        .catch(console.error);
      cardapioChannelRef.current = null;
    }

    const handleCardapioChanges = (payload: any) => {
      console.log("Mudança recebida do Supabase Realtime (Cárdapio)!", payload);
      
      if (payload.eventType === 'INSERT') {
        const newItem = { 
          ...payload.new,
          disponivel: payload.new.disponivel === 'Sim' ? 'Sim' : 'Não',
          nome_produto: payload.new.nome_produto || '',
          categoria: payload.new.categoria || '',
          descricao_produto: payload.new.descricao_produto || '',
          observacao: payload.new.observacao || '',
          promocoes: payload.new.promocoes || '',
        };
        setItensCardapio(prevItems => {
          if (!prevItems.some(item => item.id === newItem.id)) {
            // Adiciona e reordena para manter a ordem alfabética
            return [...prevItems, newItem].sort((a, b) => a.nome_produto.localeCompare(b.nome_produto));
          }
          return prevItems;
        });
      } else if (payload.eventType === 'DELETE') {
        const oldId = payload.old?.id;
        if (oldId) {
          setItensCardapio(prevItems => prevItems.filter(item => item.id !== oldId));
        }
      } else if (payload.eventType === 'UPDATE') {
        const updatedItemData = { 
          ...payload.new,
          disponivel: payload.new.disponivel === 'Sim' ? 'Sim' : 'Não',
          nome_produto: payload.new.nome_produto || '',
          categoria: payload.new.categoria || '',
          descricao_produto: payload.new.descricao_produto || '',
          observacao: payload.new.observacao || '',
          promocoes: payload.new.promocoes || '',
        };
        setItensCardapio(prevItems => 
          prevItems.map(item => {
            if (item.id === updatedItemData.id) {
              // Atualiza o item, preservando o estado de edição
              // e os dados originais se estiver editando
              return { 
                  ...item, // Mantém estado de edição e originais
                  ...updatedItemData, // Aplica atualizações do DB
              }; 
            }
            return item;
          }).sort((a, b) => a.nome_produto.localeCompare(b.nome_produto)) // Reordena após atualização
        );
      }
    };

    cardapioChannelRef.current = supabase
      .channel('cardapio_realtime_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'Cárdapio' }, // Confirmar nome da tabela
        handleCardapioChanges
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('Conectado ao canal Realtime do Cardapio!');
          setError(null);
          setReconnecting(false);
          reconnectAttemptsRef.current = 0;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          const errorMsg = status === 'CHANNEL_ERROR' ? (err?.message || 'Erro desconhecido') : status;
          console.error(`Erro/Status no canal Realtime do Cardapio: ${errorMsg}`);
          handleReconnect(errorMsg);
        }
      });
  }, []); 

  // Função para gerenciar reconexões
  const handleReconnect = useCallback((errorMessage: string) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttemptsRef.current += 1;
      setReconnecting(true);
      setError(null); 
      
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log(`Tentativa de reconexão ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}...`);
        setupRealtimeChannel();
      }, RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current - 1)); 
    } else {
      setReconnecting(false);
      setError(`Erro de conexão em tempo real (Cardápio): ${errorMessage} - Falha após ${MAX_RECONNECT_ATTEMPTS} tentativas. Atualize a página.`);
    }
  }, [setupRealtimeChannel]);

  // Efeito para inicializar e limpar o canal Realtime
  useEffect(() => {
    fetchItensCardapio('initial mount');
    setupRealtimeChannel();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (cardapioChannelRef.current) {
        supabase.removeChannel(cardapioChannelRef.current)
          .then(status => console.log('Canal Realtime (Cárdapio) removido, status:', status))
          .catch(console.error);
        cardapioChannelRef.current = null;
      }
    };
  }, [fetchItensCardapio, setupRealtimeChannel]);

  // Handlers para o modal de adição
  const handleNovoItemInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNovoItem(prev => ({ ...prev, [name]: value }));
  };
  
  const handleNovoItemDisponivelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setNovoItem(prev => ({ ...prev, disponivel: e.target.value as 'Sim' | 'Não' }));
  };

  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoItem.nome_produto || !novoItem.categoria) {
      alert('Nome do produto e categoria são obrigatórios.');
      return;
    }
    setSaving(true);
    
    // Não precisa calcular maxId, o Supabase deve gerar o ID
    // const maxId = itensCardapio.reduce((max, item) => Math.max(max, item.id), 0);
    // const nextId = maxId + 1;
    
    const itemParaSalvar = {
        // id: nextId, // Deixar o DB gerar o ID
        nome_produto: novoItem.nome_produto,
        categoria: novoItem.categoria,
        disponivel: novoItem.disponivel,
        descricao_produto: novoItem.descricao_produto || null,
        observacao: novoItem.observacao || null,
        promocoes: novoItem.promocoes || null,
    };
    
    const { error: insertError } = await supabase
      .from('Cárdapio') // Confirmar nome da tabela
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
        categoria: categoriasOrdenadas[0],
        disponivel: 'Sim',
        descricao_produto: '',
        observacao: '',
        promocoes: '',
      });
      // Realtime deve atualizar a lista
    }
  };

  // Handlers para o modal de exclusão
  const openDeleteConfirmationModal = (item: CardapioItem) => {
    setItemToDelete(item);
    setIsConfirmDeleteModalOpen(true);
  };

  const handleDeleteItem = async () => {
    if (!itemToDelete) return;
    setSaving(true);
    const { error: deleteError } = await supabase
      .from('Cárdapio') // Confirmar nome da tabela
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
      // Realtime deve atualizar a lista
    }
  };

  // Handlers para edição inline
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
            // Ao cancelar, restaura os valores originais
            return {
              ...item,
              isEditing: false,
              nome_produto: item.originalNome ?? item.nome_produto,
              categoria: item.originalCategoria ?? item.categoria,
              disponivel: item.originalDisponivel ?? item.disponivel,
              descricao_produto: item.originalDescricao ?? item.descricao_produto,
              observacao: item.originalObservacao ?? item.observacao,
              promocoes: item.originalPromocoes ?? item.promocoes,
            };
          }
        }
        // Se outro item estiver sendo editado, cancela a edição dele
        // return { ...item, isEditing: false }; 
        // Decisão: Permitir múltiplos edits ou apenas um por vez?
        // Por enquanto, permite múltiplos, mas o botão Salvar Todos salva todos.
        return item; 
      })
    );
  };

  const handleEditInputChange = (itemId: number, field: keyof CardapioItem, value: any) => {
    setItensCardapio(prevItens =>
      prevItens.map(item =>
        item.id === itemId ? { ...item, [field]: value } : item
      )
    );
  };

  // Itens com alterações pendentes
  const itemsComAlteracoes = useMemo(() => {
    return itensCardapio.filter(item => 
      item.isEditing && 
      (item.nome_produto !== item.originalNome ||
       item.categoria !== item.originalCategoria ||
       item.disponivel !== item.originalDisponivel ||
       item.descricao_produto !== item.originalDescricao ||
       item.observacao !== item.originalObservacao ||
       item.promocoes !== item.originalPromocoes)
    );
  }, [itensCardapio]);

  // Salvar todas as alterações
  const handleSaveAllChanges = async () => {
    if (itemsComAlteracoes.length === 0) {
      // alert("Nenhuma alteração para salvar."); // Pode ser silencioso
      // Apenas desativa o modo de edição dos itens que não mudaram
       setItensCardapio(prev => prev.map(item => item.isEditing ? { ...item, isEditing: false } : item));
      return;
    }
    setSaving(true);
    const updates = itemsComAlteracoes.map(item => {
      const { id, nome_produto, categoria, disponivel, descricao_produto, observacao, promocoes } = item;
      return supabase
        .from('Cárdapio') // Confirmar nome da tabela
        .update({ 
          nome_produto, 
          categoria, 
          disponivel, 
          descricao_produto, 
          observacao,
          promocoes
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
        alert("Todas as alterações foram salvas com sucesso!");
        setItensCardapio(prev => prev.map(item => {
          if (itemsComAlteracoes.some(changedItem => changedItem.id === item.id)) {
            // Limpa o estado original e sai do modo de edição após salvar
            const { originalNome, originalCategoria, originalDisponivel, originalDescricao, originalObservacao, originalPromocoes, ...rest } = item;
            return { ...rest, isEditing: false };
          }
          return item;
        }));
      }
    } catch (e) {
      console.error("Erro geral ao salvar alterações:", e);
      alert("Ocorreu um erro inesperado ao salvar as alterações.");
    }
    setSaving(false);
  };

  // Loading e Error States
  if (loading && itensCardapio.length === 0) {
    return <div className="text-center p-10"><Loader2 className="h-12 w-12 text-pink-500 animate-spin mx-auto" /></div>;
  }

  if (error && itensCardapio.length === 0) {
    return (
      <div className="text-center p-10">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg shadow-sm">
          <p className="text-xl font-semibold mb-2">Erro ao Carregar Cardápio</p>
          <p className="mb-3">{error}</p>
          {!reconnecting && reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS && (
            <button 
              onClick={() => {
                reconnectAttemptsRef.current = 0;
                setError(null);
                fetchItensCardapio('retry button');
                setupRealtimeChannel();
              }}
              className="mt-3 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
            >
              Tentar Novamente
            </button>
          )}
        </div>
      </div>
    );
  }

  // Agrupar itens por categoria na ordem correta
  const categoriasMapeadas = useMemo(() => {
    const grouped: Record<string, CardapioItem[]> = {};
    // Inicializa todas as categorias ordenadas
    categoriasOrdenadas.forEach(cat => grouped[cat] = []);
    
    // Agrupa os itens
    itensCardapio.forEach(item => {
      const categoria = item.categoria || 'Sem Categoria';
      if (!grouped[categoria]) {
        grouped[categoria] = []; // Cria se não existir (caso raro)
      }
      grouped[categoria].push(item);
    });

    // Ordena itens dentro de cada categoria alfabeticamente
    Object.keys(grouped).forEach(categoria => {
        grouped[categoria].sort((a, b) => a.nome_produto.localeCompare(b.nome_produto));
    });

    return grouped;
  }, [itensCardapio]);

  // Renderização principal
  return (
    <div className="container mx-auto p-4 pb-20">
      {/* Mensagem de erro não bloqueante */}
      {error && itensCardapio.length > 0 && (
         <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg shadow-sm flex items-center justify-center">
            <AlertTriangle size={20} className="mr-2 flex-shrink-0" /> 
            <span className="flex-grow text-center text-sm sm:text-base">{error}</span>
            {reconnecting && <Loader2 size={20} className="animate-spin ml-2 flex-shrink-0" />}
         </div>
      )}
      
      {/* Cabeçalho e Botão Adicionar */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-semibold text-gray-700">Itens do Cardápio</h2>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md flex items-center transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:ring-offset-1"
        >
          <PlusCircle size={20} className="mr-2" />
          Adicionar Novo Item
        </button>
      </div>

      {/* Banner Salvar Alterações (Sticky) */}
      {itemsComAlteracoes.length > 0 && (
        <div className="sticky top-4 z-40 mb-4">
            <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-lg shadow-md flex flex-col sm:flex-row justify-between items-center space-y-2 sm:space-y-0">
                <div className="flex items-center">
                    <AlertTriangle size={20} className="mr-2 flex-shrink-0 text-blue-600" />
                    <span>Você tem {itemsComAlteracoes.length} item(ns) com alterações não salvas.</span>
                </div>
                <button
                    onClick={handleSaveAllChanges}
                    disabled={saving}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow flex items-center transition-all duration-150 w-full sm:w-auto justify-center focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1"
                >
                    {saving ? <Loader2 size={18} className="animate-spin mr-2" /> : <Save size={18} className="mr-2" />}
                    {saving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
            </div>
        </div>
      )}

      {/* Modal Adicionar Item */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white p-6 sm:p-8 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <h3 className="text-2xl font-semibold mb-6 text-gray-800 text-center flex-shrink-0">Adicionar Novo Item</h3>
            <form id="add-item-form" onSubmit={handleAddNewItem} className="flex-grow overflow-y-auto pr-2 space-y-4 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
              {/* Campos do formulário (mantidos) */}
              <div>
                <label htmlFor="nome_produto_novo" className="block text-sm font-medium text-gray-700 mb-1">Nome do Produto</label>
                <input type="text" name="nome_produto" id="nome_produto_novo" value={novoItem.nome_produto || ''} onChange={handleNovoItemInputChange} required className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 transition-colors" />
              </div>
              <div>
                <label htmlFor="categoria_novo" className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select name="categoria" id="categoria_novo" value={novoItem.categoria} onChange={handleNovoItemInputChange} required className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 transition-colors appearance-none bg-white bg-no-repeat bg-right pr-8" style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`}}>
                  {categoriasOrdenadas.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                </select>
              </div>
              <div>
                <label htmlFor="disponivel_novo" className="block text-sm font-medium text-gray-700 mb-1">Disponível</label>
                <select name="disponivel" id="disponivel_novo" value={novoItem.disponivel} onChange={handleNovoItemDisponivelChange} required className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 transition-colors appearance-none bg-white bg-no-repeat bg-right pr-8" style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`}}>
                  <option value="Sim">Sim</option>
                  <option value="Não">Não</option>
                </select>
              </div>
              <div>
                <label htmlFor="descricao_produto_novo" className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea name="descricao_produto" id="descricao_produto_novo" value={novoItem.descricao_produto || ''} onChange={handleNovoItemInputChange} rows={3} className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 transition-colors" />
              </div>
              <div>
                <label htmlFor="promocoes_novo" className="block text-sm font-medium text-gray-700 mb-1">Promoções</label>
                <textarea name="promocoes" id="promocoes_novo" value={novoItem.promocoes || ''} onChange={handleNovoItemInputChange} rows={2} className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 transition-colors" />
              </div>
              <div>
                <label htmlFor="observacao_novo" className="block text-sm font-medium text-gray-700 mb-1">Observação</label>
                <textarea name="observacao" id="observacao_novo" value={novoItem.observacao || ''} onChange={handleNovoItemInputChange} rows={2} className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 transition-colors" />
              </div>
            </form>
            {/* Rodapé Fixo com Botões */}
            <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end space-x-3 flex-shrink-0">
              <button type="button" onClick={() => setIsAddModalOpen(false)} disabled={saving} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors flex items-center focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1">
                <XCircle size={18} className="mr-1.5"/> Cancelar
              </button>
              <button type="submit" form="add-item-form" disabled={saving} className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-lg shadow transition-colors flex items-center focus:outline-none focus:ring-2 focus:ring-pink-400 focus:ring-offset-1">
                {saving ? <Loader2 size={18} className="mr-1.5 animate-spin"/> : <Save size={18} className="mr-1.5"/>}
                {saving ? 'Salvando...' : 'Salvar Novo Item'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmar Exclusão */}
      {isConfirmDeleteModalOpen && itemToDelete && (
         <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">
            <div className="text-center">
                <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-3 text-gray-800">Confirmar Remoção</h3>
                <p className="text-gray-600 mb-6">
                  Você tem certeza que deseja remover o item "<strong>{itemToDelete.nome_produto}</strong>"?
                  <br/>Esta ação não poderá ser desfeita.
                </p>
            </div>
            <div className="flex justify-center space-x-4">
              <button onClick={() => setIsConfirmDeleteModalOpen(false)} disabled={saving} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1">
                Cancelar
              </button>
              <button onClick={handleDeleteItem} disabled={saving} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg shadow transition-colors flex items-center focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1">
                {saving ? <Loader2 size={18} className="mr-1.5 animate-spin"/> : <Trash2 size={18} className="mr-1.5"/>}
                {saving ? 'Removendo...' : 'Confirmar Remoção'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mensagem de Nenhum Item */}
      {itensCardapio.length === 0 && !loading && !error && (
        <div className="text-center text-gray-500 mt-12">
          <p className="text-2xl mb-2">Nenhum item no cardápio ainda.</p>
          <p className="text-lg">Clique em "Adicionar Novo Item" para começar.</p>
        </div>
      )}
      
      {/* Lista de Categorias e Itens - Renderizando na ordem correta */}
      {categoriasOrdenadas.map((categoria) => {
        const itensDaCategoria = categoriasMapeadas[categoria];
        if (!itensDaCategoria || itensDaCategoria.length === 0) return null; // Pula categorias vazias
        
        return (
          <div key={categoria} className="mb-10">
            <h3 className="text-2xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">{categoria}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {itensDaCategoria.map(item => (
                <div 
                  key={item.id} 
                  // Estilo do card restaurado
                  className={`bg-white rounded-xl border border-gray-200 shadow-md hover:shadow-lg transition-all duration-300 flex flex-col h-full ${
                    item.isEditing ? 'ring-2 ring-pink-400 ring-offset-1' : ''
                  }`}
                >
                  {/* Conteúdo do Card */}
                  <div className="p-4 flex-grow flex flex-col">
                    {/* Nome e Disponibilidade */}
                    <div className="text-center mb-3">
                      {item.isEditing ? (
                        <input 
                          type="text" 
                          value={item.nome_produto}
                          onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)} 
                          className="w-full p-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-center text-lg font-semibold mb-1 transition-colors"
                        />
                      ) : (
                        <h4 className="text-lg font-semibold text-gray-800 mb-1 break-words">
                          {item.nome_produto || "(Item sem nome)"}
                        </h4>
                      )}
                      {item.isEditing ? (
                        <select 
                          value={item.disponivel} 
                          onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value as 'Sim' | 'Não')} 
                          className="p-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm appearance-none bg-white bg-no-repeat bg-right pr-8 transition-colors" 
                          style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`}}
                        >
                          <option value="Sim">Disponível</option>
                          <option value="Não">Indisponível</option>
                        </select>
                      ) : (
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium inline-block border ${
                          item.disponivel === 'Sim' 
                            ? 'bg-green-50 text-green-700 border-green-200'
                            : 'bg-red-50 text-red-700 border-red-200'
                        }`}>
                          {item.disponivel}
                        </span>
                      )}
                    </div>
                    
                    {/* Categoria (apenas em modo de edição) */}
                    {item.isEditing && (
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-gray-500 mb-0.5">Categoria:</label>
                        <select 
                          value={item.categoria} 
                          onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)} 
                          className="w-full p-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm appearance-none bg-white bg-no-repeat bg-right pr-8 transition-colors"
                          style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`}}
                        >
                          {categoriasOrdenadas.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                          {/* Adiciona a categoria atual se não estiver na lista padrão */}
                          {!categoriasOrdenadas.includes(item.categoria) && <option value={item.categoria}>{item.categoria}</option>}
                        </select>
                      </div>
                    )}
                    
                    {/* Descrição */}
                    {(item.descricao_produto || item.isEditing) && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-0.5">Descrição:</h5>
                        {item.isEditing ? (
                          <textarea 
                            value={item.descricao_produto || ''} 
                            onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)} 
                            rows={3} 
                            className="w-full p-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm transition-colors"
                          />
                        ) : (
                          <p className="text-gray-600 text-sm text-justify break-words">{item.descricao_produto}</p>
                        )}
                      </div>
                    )}
                    
                    {/* Promoções */}
                    {(item.promocoes || item.isEditing) && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-0.5">Promoções:</h5>
                        {item.isEditing ? (
                          <textarea 
                            value={item.promocoes || ''} 
                            onChange={(e) => handleEditInputChange(item.id, 'promocoes', e.target.value)} 
                            rows={2} 
                            className="w-full p-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm transition-colors"
                          />
                        ) : (
                          <div className="bg-pink-50 border border-pink-100 text-pink-800 p-2 rounded-lg text-sm text-justify break-words">
                            {item.promocoes}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Observação */}
                    {(item.observacao || item.isEditing) && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-0.5">Observação:</h5>
                        {item.isEditing ? (
                          <textarea 
                            value={item.observacao || ''} 
                            onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)} 
                            rows={2} 
                            className="w-full p-1 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm transition-colors"
                          />
                        ) : (
                          <p className="text-gray-600 italic text-sm text-justify break-words">{item.observacao}</p>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Botões de Ação (Sempre no final) - Estilo restaurado */}
                  <div className="p-3 border-t border-gray-100 bg-gray-50 mt-auto flex justify-center space-x-3">
                    {item.isEditing ? (
                      <button 
                        onClick={() => toggleEditMode(item.id)} // Botão Cancelar
                        className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200 rounded-lg shadow-sm text-sm font-medium transition-all duration-150 flex items-center focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-1"
                      >
                        <XCircle size={14} className="mr-1.5" /> Cancelar
                      </button>
                    ) : (
                      <button 
                        onClick={() => toggleEditMode(item.id)} // Botão Editar
                        className="px-4 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg shadow-sm text-sm font-medium transition-all duration-150 flex items-center focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1"
                      >
                        <Edit3 size={14} className="mr-1.5" /> Editar
                      </button>
                    )}
                    <button 
                      onClick={() => openDeleteConfirmationModal(item)} // Botão Excluir
                      className="px-4 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg shadow-sm text-sm font-medium transition-all duration-150 flex items-center focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1"
                    >
                      <Trash2 size={14} className="mr-1.5" /> Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default CardapioPage;


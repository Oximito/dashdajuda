import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { PlusCircle, Save, XCircle, Trash2, Edit3, AlertTriangle, Loader2 } from 'lucide-react';
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface CardapioItem {
  id: number;
  categoria: string;
  disponivel: boolean;
  nome_produto: string;
  descricao_produto?: string | null;
  observacao?: string | null;
  promocoes?: string | null;
  isEditing?: boolean;
  originalNome?: string;
  originalCategoria?: string;
  originalDisponivel?: boolean;
  originalDescricao?: string | null;
  originalObservacao?: string | null;
  originalPromocoes?: string | null;
}

const categoriasOrdenadas = [
  "Marmita do dia",
  "Marmita clássica",
  "Mix de salada",
  "Bebida",
  "Adicional",
  "Unidade",
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
  const RECONNECT_DELAY = 3000; // 3 segundos

  const [novoItem, setNovoItem] = useState<Partial<Omit<CardapioItem, 'id'>>>({ 
    nome_produto: '',
    categoria: categoriasOrdenadas[0],
    disponivel: true,
    descricao_produto: '',
    observacao: '',
    promocoes: '',
  });

  // Função para buscar itens do cardápio
  const fetchItensCardapio = useCallback(async (source?: string) => {
    console.log(`Buscando itens do cardápio... (Origem: ${source || 'desconhecida'})`);
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('Cárdapio')
      .select('*')
      .order('categoria', { ascending: true })
      .order('nome_produto', { ascending: true });

    if (fetchError) {
      console.error('Erro ao buscar itens do cardápio:', fetchError);
      setError(`Falha ao carregar cardápio: ${fetchError.message}`);
    } else {
      // Garantir que todos os campos de texto sejam strings vazias em vez de null
      setItensCardapio(data.map(item => ({ 
        ...item,
        nome_produto: item.nome_produto || '',
        categoria: item.categoria || '',
        descricao_produto: item.descricao_produto || '',
        observacao: item.observacao || '',
        promocoes: item.promocoes || '',
      })) as CardapioItem[]);
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
      
      // Verificar se há itens em edição antes de atualizar
      const hasEditingItems = itensCardapio.some(item => item.isEditing);
      
      if (hasEditingItems) {
        // Se houver itens em edição, apenas atualize os itens que não estão sendo editados
        if (payload.eventType === 'INSERT') {
          // Para inserções, adicione o novo item
          const newItem = payload.new;
          if (newItem && newItem.id) {
            setItensCardapio(prevItems => {
              // Verificar se o item já existe
              if (!prevItems.some(item => item.id === newItem.id)) {
                return [...prevItems, {
                  ...newItem,
                  nome_produto: newItem.nome_produto || '',
                  categoria: newItem.categoria || '',
                  descricao_produto: newItem.descricao_produto || '',
                  observacao: newItem.observacao || '',
                  promocoes: newItem.promocoes || '',
                }];
              }
              return prevItems;
            });
          }
        } else if (payload.eventType === 'DELETE') {
          // Para exclusões, remova o item se não estiver sendo editado
          const oldItem = payload.old;
          if (oldItem && oldItem.id) {
            setItensCardapio(prevItems => 
              prevItems.filter(item => 
                item.id !== oldItem.id || item.isEditing
              )
            );
          }
        } else if (payload.eventType === 'UPDATE') {
          // Para atualizações, atualize apenas se o item não estiver sendo editado
          const updatedItem = payload.new;
          if (updatedItem && updatedItem.id) {
            setItensCardapio(prevItems => 
              prevItems.map(item => {
                if (item.id === updatedItem.id && !item.isEditing) {
                  return {
                    ...updatedItem,
                    nome_produto: updatedItem.nome_produto || '',
                    categoria: updatedItem.categoria || '',
                    descricao_produto: updatedItem.descricao_produto || '',
                    observacao: updatedItem.observacao || '',
                    promocoes: updatedItem.promocoes || '',
                  };
                }
                return item;
              })
            );
          }
        }
      } else {
        // Se não houver itens em edição, busque todos os itens novamente
        fetchItensCardapio('realtime update');
      }
    };

    cardapioChannelRef.current = supabase
      .channel('cardapio_realtime_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'Cárdapio' },
        handleCardapioChanges
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('Conectado ao canal Realtime do Cardapio!');
          setError(null);
          setReconnecting(false);
          reconnectAttemptsRef.current = 0;
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Erro no canal Realtime do Cardapio:', err);
          handleReconnect(err?.message || 'Erro desconhecido');
        } else if (status === 'TIMED_OUT') {
          console.warn('Timeout na conexão Realtime do Cardapio.');
          handleReconnect('Timeout');
        } else if (status === 'CLOSED'){
          console.log('Canal Realtime (Cárdapio) fechado.');
          handleReconnect('CLOSED');
        }
      });
  }, [fetchItensCardapio, itensCardapio]);

  // Função para gerenciar reconexões
  const handleReconnect = useCallback((errorMessage: string) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttemptsRef.current += 1;
      setReconnecting(true);
      setError(`Erro de conexão em tempo real (Cardápio): ${errorMessage} - Tentando reconectar...`);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log(`Tentativa de reconexão ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}...`);
        setupRealtimeChannel();
      }, RECONNECT_DELAY);
    } else {
      setReconnecting(false);
      setError(`Erro de conexão em tempo real (Cardápio): ${errorMessage} - Falha após ${MAX_RECONNECT_ATTEMPTS} tentativas. Atualize a página.`);
    }
  }, [setupRealtimeChannel]);

  // Efeito para inicializar o canal Realtime
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

  const handleNovoItemInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNovoItem(prev => ({ ...prev, [name]: value }));
  };
  
  const handleNovoItemDisponivelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setNovoItem(prev => ({ ...prev, disponivel: e.target.value === 'Sim' }));
  };

  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoItem.nome_produto || !novoItem.categoria) {
      alert('Nome do produto e categoria são obrigatórios.');
      return;
    }
    setSaving(true);
    
    // Encontrar o maior ID atual e incrementar
    const maxId = itensCardapio.reduce((max, item) => Math.max(max, item.id), 0);
    const nextId = maxId + 1;
    
    const itemParaSalvar = {
        id: nextId,
        nome_produto: novoItem.nome_produto,
        categoria: novoItem.categoria,
        disponivel: novoItem.disponivel ? 'Sim' : 'Não', // Usar 'Sim'/'Não' para o enum
        descricao_produto: novoItem.descricao_produto || null,
        observacao: novoItem.observacao || null,
        promocoes: novoItem.promocoes || null,
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
        categoria: categoriasOrdenadas[0],
        disponivel: true,
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
              nome_produto: item.originalNome || item.nome_produto,
              categoria: item.originalCategoria || item.categoria,
              disponivel: typeof item.originalDisponivel === 'boolean' ? item.originalDisponivel : item.disponivel,
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

  const handleEditInputChange = (itemId: number, field: keyof CardapioItem, value: any) => {
    setItensCardapio(prevItens =>
      prevItens.map(item =>
        item.id === itemId ? { ...item, [field]: value } : item
      )
    );
  };

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

  const handleSaveAllChanges = async () => {
    if (itemsComAlteracoes.length === 0) {
      alert("Nenhuma alteração para salvar.");
      return;
    }
    setSaving(true);
    const updates = itemsComAlteracoes.map(item => {
      const { id, nome_produto, categoria, disponivel, descricao_produto, observacao, promocoes } = item;
      return supabase
        .from('Cárdapio')
        .update({ 
          nome_produto, 
          categoria, 
          disponivel: disponivel ? 'Sim' : 'Não', // Usar 'Sim'/'Não' para o enum
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
        setItensCardapio(prev => prev.map(item => ({...item, isEditing: false})));
      }
    } catch (e) {
      console.error("Erro geral ao salvar alterações:", e);
      alert("Ocorreu um erro inesperado ao salvar as alterações.");
    }
    setSaving(false);
  };

  if (loading && itensCardapio.length === 0) {
    return <div className="text-center p-10"><p className="text-xl text-gray-600">Carregando cardápio...</p></div>;
  }

  if (error && itensCardapio.length === 0) {
    return (
      <div className="text-center p-10">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg shadow-sm">
          <p className="text-xl">{error}</p>
          {reconnecting && (
            <div className="mt-2 flex items-center justify-center">
              <Loader2 size={20} className="animate-spin mr-2" />
              <span>Tentando reconectar...</span>
            </div>
          )}
          {!reconnecting && reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS && (
            <button 
              onClick={() => {
                reconnectAttemptsRef.current = 0;
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

  // Organizar itens por categoria na ordem especificada
  const categoriasMapeadas: Record<string, CardapioItem[]> = {};
  
  // Inicializar todas as categorias ordenadas, mesmo que vazias
  categoriasOrdenadas.forEach(categoria => {
    categoriasMapeadas[categoria] = [];
  });
  
  // Preencher com os itens existentes
  itensCardapio.forEach(item => {
    const categoria = item.categoria || 'Sem Categoria';
    if (!categoriasMapeadas[categoria]) {
      categoriasMapeadas[categoria] = [];
    }
    categoriasMapeadas[categoria].push(item);
  });

  return (
    <div className="container mx-auto p-4 pb-20">
      {error && itensCardapio.length > 0 && (
         <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg shadow-sm flex items-center justify-center">
            <AlertTriangle size={20} className="mr-2" /> 
            <span>{error}</span>
            {reconnecting && <Loader2 size={20} className="animate-spin ml-2" />}
         </div>
      )}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-semibold text-gray-700">Itens do Cardápio</h2>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md flex items-center transition-colors duration-150"
        >
          <PlusCircle size={20} className="mr-2" />
          Adicionar Novo Item
        </button>
      </div>

      {itemsComAlteracoes.length > 0 && (
        <div className="sticky top-4 z-40 mb-4">
            <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-lg shadow-md flex justify-between items-center">
                <div className="flex items-center">
                    <AlertTriangle size={20} className="mr-2" />
                    <span>Você tem {itemsComAlteracoes.length} item(ns) com alterações não salvas.</span>
                </div>
                <button
                    onClick={handleSaveAllChanges}
                    disabled={saving}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg shadow flex items-center transition-all duration-150"
                >
                    {saving ? <Loader2 size={18} className="animate-spin mr-2" /> : <Save size={18} className="mr-2" />}
                    {saving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
            </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-2xl font-semibold mb-6 text-gray-800 text-center">Adicionar Novo Item ao Cardápio</h3>
            <form onSubmit={handleAddNewItem}>
              <div className="mb-4">
                <label htmlFor="nome_produto_novo" className="block text-sm font-medium text-gray-700 mb-1">Nome do Produto</label>
                <input 
                  type="text" 
                  name="nome_produto" 
                  id="nome_produto_novo" 
                  value={novoItem.nome_produto || ''} 
                  onChange={handleNovoItemInputChange} 
                  required 
                  className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-colors" 
                />
              </div>
              <div className="mb-4">
                <label htmlFor="categoria_novo" className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select 
                  name="categoria" 
                  id="categoria_novo" 
                  value={novoItem.categoria} 
                  onChange={handleNovoItemInputChange} 
                  required 
                  className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                >
                  {categoriasOrdenadas.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                </select>
              </div>
              <div className="mb-4">
                <label htmlFor="disponivel_novo" className="block text-sm font-medium text-gray-700 mb-1">Disponível</label>
                <select 
                  name="disponivel" 
                  id="disponivel_novo" 
                  value={novoItem.disponivel ? 'Sim' : 'Não'} 
                  onChange={handleNovoItemDisponivelChange} 
                  required 
                  className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                >
                  <option value="Sim">Sim</option>
                  <option value="Não">Não</option>
                </select>
              </div>
              <div className="mb-4">
                <label htmlFor="descricao_produto_novo" className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea 
                  name="descricao_produto" 
                  id="descricao_produto_novo" 
                  value={novoItem.descricao_produto || ''} 
                  onChange={handleNovoItemInputChange} 
                  rows={3} 
                  className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                />
              </div>
              <div className="mb-4">
                <label htmlFor="promocoes_novo" className="block text-sm font-medium text-gray-700 mb-1">Promoções</label>
                <textarea 
                  name="promocoes" 
                  id="promocoes_novo" 
                  value={novoItem.promocoes || ''} 
                  onChange={handleNovoItemInputChange} 
                  rows={2} 
                  className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                />
              </div>
              <div className="mb-6">
                <label htmlFor="observacao_novo" className="block text-sm font-medium text-gray-700 mb-1">Observação</label>
                <textarea 
                  name="observacao" 
                  id="observacao_novo" 
                  value={novoItem.observacao || ''} 
                  onChange={handleNovoItemInputChange} 
                  rows={2} 
                  className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button 
                  type="button" 
                  onClick={() => setIsAddModalOpen(false)} 
                  disabled={saving} 
                  className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors flex items-center"
                >
                  <XCircle size={18} className="mr-1"/> Cancelar
                </button>
                <button 
                  type="submit" 
                  disabled={saving} 
                  className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-lg shadow transition-colors flex items-center"
                >
                  {saving ? <Loader2 size={18} className="mr-1 animate-spin"/> : <Save size={18} className="mr-1"/>}
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
                  Você tem certeza que deseja remover o item "<strong>{itemToDelete.nome_produto}</strong>"?
                  <br/>Esta ação não poderá ser desfeita.
                </p>
            </div>
            <div className="flex justify-center space-x-4">
              <button 
                onClick={() => setIsConfirmDeleteModalOpen(false)} 
                disabled={saving} 
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleDeleteItem} 
                disabled={saving} 
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg shadow transition-colors flex items-center"
              >
                {saving ? <Loader2 size={18} className="mr-1 animate-spin"/> : <Trash2 size={18} className="mr-1"/>}
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
      
      {/* Exibir categorias na ordem especificada */}
      {categoriasOrdenadas.map(categoria => {
        const itens = categoriasMapeadas[categoria] || [];
        if (itens.length === 0) return null;
        
        return (
          <div key={categoria} className="mb-10">
            <h3 className="text-2xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">{categoria}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {itens.map(item => (
                <div 
                  key={item.id} 
                  className={`bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col h-full ${
                    item.isEditing ? 'ring-2 ring-pink-300' : ''
                  }`}
                >
                  <div className="p-5 flex-grow flex flex-col">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="text-xl font-semibold text-gray-800 text-center w-full">
                        {item.isEditing ? (
                          <input 
                            type="text" 
                            value={item.nome_produto} 
                            onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)} 
                            className="w-full p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500 text-center"
                          />
                        ) : (
                          item.nome_produto || "(Item sem nome)"
                        )}
                      </h4>
                    </div>
                    
                    <div className="mb-3 flex justify-center">
                      {item.isEditing ? (
                        <select 
                          value={item.disponivel ? 'Sim' : 'Não'} 
                          onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value === 'Sim')} 
                          className="p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                        >
                          <option value="Sim">Disponível</option>
                          <option value="Não">Indisponível</option>
                        </select>
                      ) : (
                        <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                          item.disponivel 
                            ? 'bg-green-100 text-green-800 border border-green-200' 
                            : 'bg-red-100 text-red-800 border border-red-200'
                        }`}>
                          {item.disponivel ? 'Disponível' : 'Indisponível'}
                        </span>
                      )}
                    </div>
                    
                    {item.isEditing ? (
                      <div className="mb-3">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Categoria:</label>
                        <select 
                          value={item.categoria} 
                          onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)} 
                          className="w-full p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                        >
                          {categoriasOrdenadas.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                    
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-gray-700 mb-1">Descrição:</h5>
                      {item.isEditing ? (
                        <textarea 
                          value={item.descricao_produto || ''} 
                          onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)} 
                          rows={2} 
                          className="w-full p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                        />
                      ) : (
                        <p className="text-gray-600 text-justify">{item.descricao_produto || "Sem descrição"}</p>
                      )}
                    </div>
                    
                    <div className="mb-3">
                      <h5 className="text-sm font-medium text-gray-700 mb-1">Promoções:</h5>
                      {item.isEditing ? (
                        <textarea 
                          value={item.promocoes || ''} 
                          onChange={(e) => handleEditInputChange(item.id, 'promocoes', e.target.value)} 
                          rows={2} 
                          className="w-full p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                        />
                      ) : (
                        <div className="bg-pink-50 border border-pink-200 text-pink-800 p-2 rounded text-justify">
                          {item.promocoes || "Sem promoções"}
                        </div>
                      )}
                    </div>
                    
                    {(item.observacao || item.isEditing) && (
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-1">Observação:</h5>
                        {item.isEditing ? (
                          <textarea 
                            value={item.observacao || ''} 
                            onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)} 
                            rows={2} 
                            className="w-full p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                          />
                        ) : (
                          <p className="text-gray-600 italic text-justify">{item.observacao}</p>
                        )}
                      </div>
                    )}
                  </div>
                  
                  <div className="p-4 border-t border-gray-100 bg-gray-50 mt-auto flex justify-center space-x-3">
                    {item.isEditing ? (
                      <button 
                        onClick={() => toggleEditMode(item.id)} 
                        className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded transition-colors flex items-center"
                      >
                        <XCircle size={16} className="mr-1" /> Cancelar
                      </button>
                    ) : (
                      <button 
                        onClick={() => toggleEditMode(item.id)} 
                        className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded shadow transition-colors flex items-center"
                      >
                        <Edit3 size={16} className="mr-1" /> Editar
                      </button>
                    )}
                    <button 
                      onClick={() => openDeleteConfirmationModal(item)} 
                      className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded shadow transition-colors flex items-center"
                    >
                      <Trash2 size={16} className="mr-1" /> Excluir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      
      {/* Exibir categorias não listadas em categoriasOrdenadas */}
      {Object.keys(categoriasMapeadas)
        .filter(categoria => !categoriasOrdenadas.includes(categoria))
        .map(categoria => {
          const itens = categoriasMapeadas[categoria];
          if (!itens || itens.length === 0) return null;
          
          return (
            <div key={categoria} className="mb-10">
              <h3 className="text-2xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">{categoria}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {itens.map(item => (
                  <div 
                    key={item.id} 
                    className={`bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col h-full ${
                      item.isEditing ? 'ring-2 ring-pink-300' : ''
                    }`}
                  >
                    <div className="p-5 flex-grow flex flex-col">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-xl font-semibold text-gray-800 text-center w-full">
                          {item.isEditing ? (
                            <input 
                              type="text" 
                              value={item.nome_produto} 
                              onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)} 
                              className="w-full p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500 text-center"
                            />
                          ) : (
                            item.nome_produto || "(Item sem nome)"
                          )}
                        </h4>
                      </div>
                      
                      <div className="mb-3 flex justify-center">
                        {item.isEditing ? (
                          <select 
                            value={item.disponivel ? 'Sim' : 'Não'} 
                            onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value === 'Sim')} 
                            className="p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                          >
                            <option value="Sim">Disponível</option>
                            <option value="Não">Indisponível</option>
                          </select>
                        ) : (
                          <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                            item.disponivel 
                              ? 'bg-green-100 text-green-800 border border-green-200' 
                              : 'bg-red-100 text-red-800 border border-red-200'
                          }`}>
                            {item.disponivel ? 'Disponível' : 'Indisponível'}
                          </span>
                        )}
                      </div>
                      
                      {item.isEditing ? (
                        <div className="mb-3">
                          <label className="block text-sm font-medium text-gray-700 mb-1">Categoria:</label>
                          <select 
                            value={item.categoria} 
                            onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)} 
                            className="w-full p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                          >
                            {categoriasOrdenadas.map(cat => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                            <option value={categoria}>{categoria}</option>
                          </select>
                        </div>
                      ) : null}
                      
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-1">Descrição:</h5>
                        {item.isEditing ? (
                          <textarea 
                            value={item.descricao_produto || ''} 
                            onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)} 
                            rows={2} 
                            className="w-full p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                          />
                        ) : (
                          <p className="text-gray-600 text-justify">{item.descricao_produto || "Sem descrição"}</p>
                        )}
                      </div>
                      
                      <div className="mb-3">
                        <h5 className="text-sm font-medium text-gray-700 mb-1">Promoções:</h5>
                        {item.isEditing ? (
                          <textarea 
                            value={item.promocoes || ''} 
                            onChange={(e) => handleEditInputChange(item.id, 'promocoes', e.target.value)} 
                            rows={2} 
                            className="w-full p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                          />
                        ) : (
                          <div className="bg-pink-50 border border-pink-200 text-pink-800 p-2 rounded text-justify">
                            {item.promocoes || "Sem promoções"}
                          </div>
                        )}
                      </div>
                      
                      {(item.observacao || item.isEditing) && (
                        <div className="mb-3">
                          <h5 className="text-sm font-medium text-gray-700 mb-1">Observação:</h5>
                          {item.isEditing ? (
                            <textarea 
                              value={item.observacao || ''} 
                              onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)} 
                              rows={2} 
                              className="w-full p-1.5 border border-gray-300 rounded focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
                            />
                          ) : (
                            <p className="text-gray-600 italic text-justify">{item.observacao}</p>
                          )}
                        </div>
                      )}
                    </div>
                    
                    <div className="p-4 border-t border-gray-100 bg-gray-50 mt-auto flex justify-center space-x-3">
                      {item.isEditing ? (
                        <button 
                          onClick={() => toggleEditMode(item.id)} 
                          className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded transition-colors flex items-center"
                        >
                          <XCircle size={16} className="mr-1" /> Cancelar
                        </button>
                      ) : (
                        <button 
                          onClick={() => toggleEditMode(item.id)} 
                          className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded shadow transition-colors flex items-center"
                        >
                          <Edit3 size={16} className="mr-1" /> Editar
                        </button>
                      )}
                      <button 
                        onClick={() => openDeleteConfirmationModal(item)} 
                        className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded shadow transition-colors flex items-center"
                      >
                        <Trash2 size={16} className="mr-1" /> Excluir
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

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { PlusCircle, Save, XCircle, Trash2, Edit3, AlertTriangle, Loader2 } from 'lucide-react';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

export interface CardapioItem {
  id: number;
  categoria: string;
  disponivel: boolean;
  nome_produto: string;
  descricao_produto?: string | null;
  observacao?: string | null;
  isEditing?: boolean;
  originalNome?: string;
  originalCategoria?: string;
  originalDisponivel?: boolean;
  originalDescricao?: string | null;
  originalObservacao?: string | null;
}

const categoriasPermitidas = [
  "Marmita do dia",
  "Marmita clássica",
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

  const [novoItem, setNovoItem] = useState<Partial<Omit<CardapioItem, 'id'>>>({ 
    nome_produto: '',
    categoria: categoriasPermitidas[0],
    disponivel: true,
    descricao_produto: '',
    observacao: '',
  });

  const fetchItensCardapio = useCallback(async (source?: string) => {
    console.log(`Buscando itens do cardápio... (Origem: ${source || 'desconhecida'})`);
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('Cárdapio') // Corrigido
      .select('*')
      .order('categoria', { ascending: true })
      .order('nome_produto', { ascending: true });

    if (fetchError) {
      console.error('Erro ao buscar itens do cardápio:', fetchError);
      setError(`Falha ao carregar cardápio: ${fetchError.message}`);
    } else {
      setItensCardapio(data.map(item => ({ 
        ...item,
      })) as CardapioItem[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchItensCardapio('initial mount');

    const handleCardapioChanges = (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
      console.log("Mudança recebida do Supabase Realtime (Cárdapio)!", payload);
      fetchItensCardapio('realtime update');
    };

    cardapioChannelRef.current = supabase
      .channel('cardapio_realtime_channel') // Nome do canal pode ser diferente do nome da tabela
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'Cárdapio' }, // Corrigido
        handleCardapioChanges
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('Conectado ao canal Realtime do Cardapio!');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Erro no canal Realtime do Cardapio:', err);
          setError(`Erro de conexão em tempo real (Cárdapio): ${err?.message || 'Erro desconhecido'}`);
        } else if (status === 'TIMED_OUT') {
          console.warn('Timeout na conexão Realtime do Cardapio.');
          setError('Conexão em tempo real (Cárdapio) expirou. As atualizações podem não ser instantâneas.');
        } else if (status === 'CLOSED'){
          console.log('Canal Realtime (Cárdapio) fechado.');
        }
      });

    return () => {
      if (cardapioChannelRef.current) {
        supabase.removeChannel(cardapioChannelRef.current)
          .then(status => console.log('Canal Realtime (Cárdapio) removido, status:', status))
          .catch(console.error);
        cardapioChannelRef.current = null;
      }
    };
  }, [fetchItensCardapio]);

  const handleNovoItemInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNovoItem(prev => ({ ...prev, [name]: value }));
  };
  
  const handleNovoItemDisponivelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setNovoItem(prev => ({ ...prev, disponivel: e.target.value === 'true' }));
  };

  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoItem.nome_produto || !novoItem.categoria) {
      alert('Nome do produto e categoria são obrigatórios.');
      return;
    }
    setSaving(true);
    const itemParaSalvar = {
        nome_produto: novoItem.nome_produto,
        categoria: novoItem.categoria,
        disponivel: novoItem.disponivel,
        descricao_produto: novoItem.descricao_produto || null,
        observacao: novoItem.observacao || null,
    };
    const { error: insertError } = await supabase
      .from('Cárdapio') // Corrigido
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
        categoria: categoriasPermitidas[0],
        disponivel: true,
        descricao_produto: '',
        observacao: '',
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
      .from('Cárdapio') // Corrigido
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
       item.observacao !== item.originalObservacao)
    );
  }, [itensCardapio]);

  const handleSaveAllChanges = async () => {
    if (itemsComAlteracoes.length === 0) {
      alert("Nenhuma alteração para salvar.");
      return;
    }
    setSaving(true);
    const updates = itemsComAlteracoes.map(item => {
      const { id, nome_produto, categoria, disponivel, descricao_produto, observacao } = item;
      return supabase
        .from('Cárdapio') // Corrigido
        .update({ nome_produto, categoria, disponivel, descricao_produto, observacao })
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
    return <div className="text-center p-10"><p className="text-xl text-red-600 bg-red-100 p-4 rounded-lg">{error}</p></div>;
  }

  const groupedItens = itensCardapio.reduce((acc, item) => {
    if (!acc[item.categoria]) {
      acc[item.categoria] = [];
    }
    acc[item.categoria].push(item);
    return acc;
  }, {} as Record<string, CardapioItem[]>);

  return (
    <div className="container mx-auto p-4 pb-20">
      {error && itensCardapio.length > 0 && (
         <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-center">
            <AlertTriangle size={20} className="inline mr-2" /> {error}
         </div>
      )}
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
                <input type="text" name="nome_produto" id="nome_produto_novo" value={novoItem.nome_produto || ''} onChange={handleNovoItemInputChange} required className="input-field" />
              </div>
              <div className="mb-4">
                <label htmlFor="categoria_novo" className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select name="categoria" id="categoria_novo" value={novoItem.categoria} onChange={handleNovoItemInputChange} required className="input-field">
                  {categoriasPermitidas.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                </select>
              </div>
              <div className="mb-4">
                <label htmlFor="disponivel_novo" className="block text-sm font-medium text-gray-700 mb-1">Disponível</label>
                <select name="disponivel" id="disponivel_novo" value={novoItem.disponivel ? 'true' : 'false'} onChange={handleNovoItemDisponivelChange} required className="input-field">
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </select>
              </div>
              <div className="mb-4">
                <label htmlFor="descricao_produto_novo" className="block text-sm font-medium text-gray-700 mb-1">Descrição</label>
                <textarea name="descricao_produto" id="descricao_produto_novo" value={novoItem.descricao_produto || ''} onChange={handleNovoItemInputChange} rows={3} className="input-field" />
              </div>
              <div className="mb-6">
                <label htmlFor="observacao_novo" className="block text-sm font-medium text-gray-700 mb-1">Observação</label>
                <textarea name="observacao" id="observacao_novo" value={novoItem.observacao || ''} onChange={handleNovoItemInputChange} rows={2} className="input-field" />
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
                  Você tem certeza que deseja remover o item "<strong>{itemToDelete.nome_produto}</strong>"?
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
      
      {Object.entries(groupedItens).map(([categoria, itens]) => (
        <div key={categoria} className="mb-8">
          <h3 className="text-2xl font-semibold text-pink-600 mb-4 border-b-2 border-pink-200 pb-2">{categoria}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {itens.map(item => (
                <div key={item.id} className={`p-5 rounded-lg shadow-lg border ${item.isEditing ? 'border-pink-500 ring-2 ring-pink-300' : 'border-gray-200'} bg-white`}>
                  {item.isEditing ? (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Nome</label>
                        <input type="text" value={item.nome_produto} onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)} className="input-field-edit" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Categoria</label>
                        <select value={item.categoria} onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)} className="input-field-edit">
                          {categoriasPermitidas.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Disponível</label>
                        <select value={item.disponivel ? 'true' : 'false'} onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value === 'true')} className={`input-field-edit ${item.disponivel ? 'bg-green-50' : 'bg-red-50'}`}>
                          <option value="true">Sim</option>
                          <option value="false">Não</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Descrição</label>
                        <textarea value={item.descricao_produto || ''} onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)} rows={2} className="input-field-edit" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600">Observação</label>
                        <textarea value={item.observacao || ''} onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)} rows={1} className="input-field-edit" />
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
                            <h4 className="text-xl font-bold text-gray-800 mb-1">{item.nome_produto}</h4>
                            <p className={`text-sm font-medium mb-2 px-2 py-0.5 inline-block rounded-full ${item.disponivel ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {item.disponivel ? 'Disponível' : 'Indisponível'}
                            </p>
                            {item.descricao_produto && <p className="text-gray-600 text-sm my-2"><strong>Descrição:</strong> {item.descricao_produto}</p>}
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
      ))}
    </div>
  );
};

export default CardapioPage;

// Adicionar ao seu index.css ou App.css
/*
.input-field {
  @apply mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-pink-500 focus:border-pink-500 sm:text-sm;
}

.input-field-edit {
  @apply block w-full px-2 py-1 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-pink-500 focus:border-pink-500 sm:text-sm text-sm;
}

.btn-primary {
 @apply px-4 py-2 text-sm font-medium text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 transition-colors duration-150;
}

.btn-secondary {
  @apply px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-400 transition-colors duration-150;
}

.btn-danger {
  @apply px-6 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 transition-colors duration-150 flex items-center;
}

.btn-icon {
    @apply p-2 hover:bg-gray-100 rounded-full transition-colors duration-150;
}
*/


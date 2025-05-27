import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { PlusCircle, Save, XCircle, Trash2, Edit3, AlertTriangle, Loader2 } from 'lucide-react'; 
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// Interface para o item do cardápio
export interface CardapioItem {
  id: number;
  categoria: string;
  disponivel: boolean;
  nome_produto: string;
  descricao_produto?: string | null;
  observacao?: string | null;
  promocao?: string | null;
  isEditing?: boolean;
}

// **CRÍTICO: ORDEM CORRETA DAS CATEGORIAS PARA RENDERIZAÇÃO E ORDENAÇÃO**
const categoriasOrdem = [
  "Marmita do dia",
  "Marmita clássica",
  "Omelete",
  "Mix de salada",
  "Bebida",
  "Adicional",
  "Unidade",
];

// Componente da Página do Cardápio
const CardapioPage: React.FC = () => {
  const [itensCardapio, setItensCardapio] = useState<CardapioItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState<boolean>(false);
  const [itemToDelete, setItemToDelete] = useState<CardapioItem | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const cardapioChannelRef = useRef<RealtimeChannel | null>(null);
  const [editedItems, setEditedItems] = useState<Record<number, Partial<CardapioItem>>>({});

  // Estado inicial para o formulário de novo item
  const [novoItem, setNovoItem] = useState<Partial<Omit<CardapioItem, 'id'>>>({ 
    nome_produto: '',
    categoria: categoriasOrdem[0],
    disponivel: true,
    descricao_produto: '',
    observacao: '',
    promocao: '',
  });

  // Busca itens do cardápio, com tratamento de erro e ordenação
  const fetchItensCardapio = useCallback(async (source?: string) => {
    console.log(`Buscando itens do cardápio... (Origem: ${source || 'desconhecida'})`);
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('Cárdapio')
      .select('*');

    if (fetchError) {
      console.error('Erro ao buscar itens do cardápio:', fetchError);
      setError(`Falha ao carregar cardápio: ${fetchError.message}`);
      setItensCardapio([]);
    } else {
      // **CORREÇÃO: Ordena os dados recebidos pela ordem definida em categoriasOrdem**
      const dadosOrdenados = (data as CardapioItem[]).sort((a, b) => {
        const indexA = categoriasOrdem.indexOf(a.categoria);
        const indexB = categoriasOrdem.indexOf(b.categoria);
        if (indexA === -1 && indexB === -1) return a.nome_produto.localeCompare(b.nome_produto);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        if (indexA !== indexB) return indexA - indexB;
        return a.nome_produto.localeCompare(b.nome_produto);
      });
      
      // Mantém as edições locais não salvas
      setItensCardapio(prevItens => {
        const itensEditadosAtuais = prevItens.filter(item => editedItems[item.id]);
        const mapaEditados = itensEditadosAtuais.reduce((acc, item) => {
            acc[item.id] = { ...item, ...editedItems[item.id] };
            return acc;
        }, {} as Record<number, CardapioItem>);

        return dadosOrdenados.map(itemDB => {
            if (mapaEditados[itemDB.id]) {
                return mapaEditados[itemDB.id];
            } else {
                return { ...itemDB, isEditing: false };
            }
        });
      });
      setError(null);
    }
    setLoading(false);
  }, [editedItems]);

  // Efeito para buscar dados e configurar Realtime
  useEffect(() => {
    fetchItensCardapio('initial mount');

    const handleCardapioChanges = (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
      console.log("Mudança recebida do Supabase Realtime (Cárdapio)!", payload);
      fetchItensCardapio('realtime update'); 
    };

    cardapioChannelRef.current = supabase
      .channel('cardapio_realtime_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'Cárdapio' }, handleCardapioChanges)
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('Conectado ao canal Realtime do Cardapio!');
          setError(prevError => prevError?.includes('(Cárdapio)') ? null : prevError);
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
        supabase.removeChannel(cardapioChannelRef.current).catch(console.error);
        cardapioChannelRef.current = null;
      }
    };
  }, [fetchItensCardapio]);

  // Handlers para o formulário de novo item
  const handleNovoItemInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setNovoItem(prev => ({ ...prev, [name]: value }));
  };
  
  const handleNovoItemDisponivelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setNovoItem(prev => ({ ...prev, disponivel: e.target.value === 'true' }));
  };

  // Adiciona novo item ao banco de dados
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
        promocao: novoItem.promocao || null,
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
        categoria: categoriasOrdem[0],
        disponivel: true,
        descricao_produto: '',
        observacao: '',
        promocao: '',
      });
    }
  };

  // Abre modal de confirmação para deletar item
  const openDeleteConfirmationModal = (item: CardapioItem) => {
    setItemToDelete(item);
    setIsConfirmDeleteModalOpen(true);
  };

  // Deleta item do banco de dados
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

  // Ativa/desativa modo de edição para um item
  const toggleEditMode = (itemId: number) => {
    setItensCardapio(prevItens =>
      prevItens.map(item => {
        if (item.id === itemId) {
          if (!item.isEditing) {
            setEditedItems(prev => ({ ...prev, [itemId]: {} }));
            return { ...item, isEditing: true };
          } else {
            const originalItem = itensCardapio.find(i => i.id === itemId);
            setEditedItems(prev => {
                const newState = { ...prev };
                delete newState[itemId];
                return newState;
            });
            return { ...originalItem, isEditing: false } as CardapioItem;
          }
        }
        return item;
      })
    );
  };

  // Handler para mudanças nos inputs de edição
  const handleEditInputChange = (itemId: number, field: keyof CardapioItem, value: any) => {
    const finalValue = field === 'disponivel' ? (value === 'true') : value;
    setItensCardapio(prevItens =>
      prevItens.map(item =>
        item.id === itemId ? { ...item, [field]: finalValue } : item
      )
    );
    setEditedItems(prev => ({
        ...prev,
        [itemId]: { ...prev[itemId], [field]: finalValue }
    }));
  };

  // Calcula quais itens têm alterações pendentes
  const itemsComAlteracoes = useMemo(() => {
    return Object.keys(editedItems).filter(idStr => {
        const id = parseInt(idStr, 10);
        const itemAtual = itensCardapio.find(i => i.id === id);
        const alteracoes = editedItems[id];
        if (!itemAtual || !alteracoes) return false;
        return Object.keys(alteracoes).some(key => alteracoes[key as keyof CardapioItem] !== itemAtual[key as keyof CardapioItem]);
    }).map(idStr => itensCardapio.find(i => i.id === parseInt(idStr, 10))).filter(Boolean) as CardapioItem[];
  }, [itensCardapio, editedItems]);

  // Salva todas as alterações pendentes
  const handleSaveAllChanges = async () => {
    if (itemsComAlteracoes.length === 0) {
      alert("Nenhuma alteração para salvar.");
      return;
    }
    setSaving(true);
    const updates = itemsComAlteracoes.map(item => {
      const { id, nome_produto, categoria, disponivel, descricao_produto, observacao, promocao } = item;
      const updateData: Partial<CardapioItem> = {
        nome_produto,
        categoria,
        disponivel,
        descricao_produto,
        observacao,
        promocao,
      };
      return supabase.from('Cárdapio').update(updateData).match({ id });
    });

    try {
      const results = await Promise.all(updates);
      const errors = results.filter(result => result.error);
      if (errors.length > 0) {
        console.error("Erros ao salvar alterações:", errors);
        alert(`Houve ${errors.length} erro(s) ao salvar. Verifique o console.`);
      } else {
        alert("Todas as alterações foram salvas com sucesso!");
        setItensCardapio(prev => prev.map(item => itemsComAlteracoes.find(i => i.id === item.id) ? {...item, isEditing: false} : item));
        setEditedItems({});
      }
    } catch (e) {
      console.error("Erro geral ao salvar alterações:", e);
      alert("Ocorreu um erro inesperado ao salvar as alterações.");
    }
    setSaving(false);
  };

  // Renderização condicional de loading e erro inicial
  if (loading && itensCardapio.length === 0) {
    return <div className="text-center p-10"><Loader2 className="h-12 w-12 text-pink-500 animate-spin mx-auto" /></div>;
  }

  if (error && itensCardapio.length === 0) {
    return <div className="text-center p-10"><p className="text-xl text-red-600 bg-red-100 p-4 rounded-lg">{error}</p></div>;
  }

  // **CRÍTICO: CORRIGINDO AGRUPAMENTO PARA GARANTIR ORDEM E VISIBILIDADE**
  const groupedItens = useMemo(() => {
    const groups: Record<string, CardapioItem[]> = {};
    // Inicializa todos os grupos na ordem correta
    categoriasOrdem.forEach(cat => { groups[cat] = []; });
    // Preenche os grupos com os itens existentes
    itensCardapio.forEach(item => {
      const categoria = item.categoria;
      if (groups[categoria]) { // Adiciona apenas se a categoria for conhecida
        groups[categoria].push(item);
      } else {
        // Opcional: Agrupar categorias desconhecidas
        if (!groups["Outros"]) groups["Outros"] = [];
        groups["Outros"].push(item);
      }
    });
    return groups;
  }, [itensCardapio]);

  // Renderização principal da página
  return (
    <div className="container mx-auto p-4 pb-32 relative">
      {/* Exibe erro não bloqueante */}
      {error && itensCardapio.length > 0 && (
         <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md text-center shadow-sm">
            <AlertTriangle size={20} className="inline mr-2" /> {error}
         </div>
      )}
      {/* Cabeçalho com botão Adicionar */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-3xl font-semibold text-gray-700">Itens do Cardápio</h2>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="btn-primary" // Usando classe global
        >
          <PlusCircle size={20} className="mr-2" />
          Adicionar Novo Item
        </button>
      </div>

      {/* Botão Salvar Alterações - STICKY */}
      {itemsComAlteracoes.length > 0 && (
        <div className="sticky bottom-4 w-full flex justify-center z-40 px-4">
            {/* **REFORMULAÇÃO: Estilo do botão Salvar Alterações (azul)** */}
            <button
                onClick={handleSaveAllChanges}
                disabled={saving}
                className="btn-primary bg-blue-600 hover:bg-blue-700 focus:ring-blue-400 py-3 px-6 text-lg shadow-xl transform hover:scale-105"
            >
                {saving ? <Loader2 size={24} className="animate-spin mr-2" /> : <Save size={24} className="mr-2" />}
                {saving ? 'Salvando...' : `Salvar ${itemsComAlteracoes.length} Alterações`}
            </button>
        </div>
      )}

      {/* **CRÍTICO: RENDERIZAÇÃO DAS CATEGORIAS NA ORDEM CORRETA** */}
      {categoriasOrdem.map(categoria => {
        const itensDaCategoria = groupedItens[categoria] || [];
        // **CORREÇÃO: Renderiza a seção mesmo se estiver vazia, para manter a ordem**
        // if (itensDaCategoria.length === 0) return null; // REMOVIDO - Mostrar todas as categorias

        return (
          <div key={categoria} className="mb-10">
            <h3 className="text-2xl font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-200">{categoria}</h3>
            {itensDaCategoria.length === 0 ? (
              <p className="text-gray-500 italic ml-2">Nenhum item nesta categoria.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {itensDaCategoria.map(item => (
                  <div key={item.id} className={`card-base ${item.isEditing ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`}>
                    {/* **REFORMULAÇÃO: Layout do Card (Visual e Edição)** */}
                    {!item.isEditing ? (
                      // MODO VISUALIZAÇÃO
                      <div className="flex flex-col h-full">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="text-lg font-semibold text-gray-900 break-words flex-grow mr-2">{item.nome_produto}</h4>
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${item.disponivel ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.disponivel ? 'Disponível' : 'Indisponível'}
                          </span>
                        </div>
                        {/* Descrição, Observação, Promoção - Só mostra se tiver conteúdo */}
                        {item.descricao_produto && <p className="text-sm text-gray-600 mb-1 mt-1 break-words"><strong className='text-gray-700'>Descrição:</strong> {item.descricao_produto}</p>}
                        {item.observacao && <p className="text-sm text-gray-600 mb-1 mt-1 break-words"><strong className='text-gray-700'>Observação:</strong> {item.observacao}</p>}
                        {item.promocao && <p className="text-sm text-pink-700 bg-pink-50 p-2 rounded-md mt-2 break-words"><strong className='font-semibold'>Promoção:</strong> {item.promocao}</p>}
                        {/* Espaçador para empurrar botões para baixo */}
                        <div className="flex-grow"></div> 
                        {/* Botões de Ação */}
                        <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end space-x-2">
                          <button onClick={() => toggleEditMode(item.id)} className="btn-icon text-blue-600 hover:text-blue-800"><Edit3 size={18} /></button>
                          <button onClick={() => openDeleteConfirmationModal(item)} className="btn-icon text-red-600 hover:text-red-800"><Trash2 size={18} /></button>
                        </div>
                      </div>
                    ) : (
                      // MODO EDIÇÃO
                      <div className="space-y-3">
                        <div>
                          <label className="label-style">Nome</label>
                          <input type="text" value={item.nome_produto} onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)} className="input-field" />
                        </div>
                        <div>
                          <label className="label-style">Disponível</label>
                          <select value={item.disponivel.toString()} onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value)} className="input-field">
                            <option value="true">Sim</option>
                            <option value="false">Não</option>
                          </select>
                        </div>
                        <div>
                          <label className="label-style">Descrição</label>
                          <textarea value={item.descricao_produto || ''} onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)} className="input-field" rows={2}></textarea>
                        </div>
                        <div>
                          <label className="label-style">Observação</label>
                          <textarea value={item.observacao || ''} onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)} className="input-field" rows={2}></textarea>
                        </div>
                        <div>
                          <label className="label-style">Promoção</label>
                          <textarea value={item.promocao || ''} onChange={(e) => handleEditInputChange(item.id, 'promocao', e.target.value)} className="input-field" rows={2}></textarea>
                        </div>
                        <div>
                          <label className="label-style">Categoria</label>
                          <select value={item.categoria} onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)} className="input-field">
                            {categoriasOrdem.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                            {/* Adicionar opção para categoria não listada? */}
                          </select>
                        </div>
                        {/* Botões Salvar/Cancelar Edição */}
                        <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                          <button onClick={() => toggleEditMode(item.id)} className="btn-secondary text-sm"><XCircle size={16} className='mr-1'/> Cancelar</button>
                          {/* Botão Salvar Individual (opcional, pode depender do Salvar Todos) */}
                          {/* <button onClick={() => handleSaveChangesForItem(item.id)} className="btn-primary bg-blue-600 hover:bg-blue-700 text-sm"><Save size={16} className='mr-1'/> Salvar</button> */}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      
      {/* **REFORMULAÇÃO: Modal Adicionar Item - Estilo "Apple"** */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <form onSubmit={handleAddNewItem} className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            {/* Cabeçalho */}
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-800">Adicionar Novo Item ao Cardápio</h3>
            </div>
            {/* Conteúdo Rolável */}
            <div className="p-6 overflow-y-auto flex-grow space-y-4">
              <div>
                <label htmlFor="add-nome_produto" className="label-style">Nome do Produto <span className="text-red-500">*</span></label>
                <input type="text" id="add-nome_produto" name="nome_produto" value={novoItem.nome_produto} onChange={handleNovoItemInputChange} className="input-field" required />
              </div>
              <div>
                <label htmlFor="add-categoria" className="label-style">Categoria <span className="text-red-500">*</span></label>
                <select id="add-categoria" name="categoria" value={novoItem.categoria} onChange={handleNovoItemInputChange} className="input-field" required>
                  {categoriasOrdem.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="add-disponivel" className="label-style">Disponível?</label>
                <select id="add-disponivel" name="disponivel" value={novoItem.disponivel?.toString()} onChange={handleNovoItemDisponivelChange} className="input-field">
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </select>
              </div>
              <div>
                <label htmlFor="add-descricao" className="label-style">Descrição</label>
                <textarea id="add-descricao" name="descricao_produto" value={novoItem.descricao_produto || ''} onChange={handleNovoItemInputChange} className="input-field" rows={3}></textarea>
              </div>
              <div>
                <label htmlFor="add-observacao" className="label-style">Observação</label>
                <textarea id="add-observacao" name="observacao" value={novoItem.observacao || ''} onChange={handleNovoItemInputChange} className="input-field" rows={3}></textarea>
              </div>
              <div>
                <label htmlFor="add-promocao" className="label-style">Promoção</label>
                <textarea id="add-promocao" name="promocao" value={novoItem.promocao || ''} onChange={handleNovoItemInputChange} className="input-field" rows={3}></textarea>
              </div>
            </div>
            {/* Rodapé Fixo */}
            <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3 rounded-b-xl">
              <button type="button" onClick={() => setIsAddModalOpen(false)} disabled={saving} className="btn-secondary">
                <XCircle size={18} className="inline mr-1"/> Cancelar
              </button>
              <button type="submit" disabled={saving} className="btn-primary bg-green-600 hover:bg-green-700 focus:ring-green-400">
                {saving ? <Loader2 size={18} className="inline mr-1 animate-spin"/> : <PlusCircle size={18} className="inline mr-1"/>}
                {saving ? 'Adicionando...' : 'Adicionar Item'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Confirmação de Exclusão - Estilo mantido */}
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
    </div>
  );
};

export default CardapioPage;

// **Lembrete: Definir estilos globais em App.css**
/*
.card-base { @apply border border-gray-200 p-5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 bg-white flex flex-col min-h-[250px]; }
.label-style { @apply block text-sm font-medium text-gray-700 mb-1; }
.input-field { @apply w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm transition-all duration-150 bg-white; }
.btn-icon { @apply p-1 rounded-md hover:bg-gray-100 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-gray-300; }
.btn-primary { @apply px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg shadow-md text-sm font-medium transition-all duration-150 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-pink-400 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-secondary { @apply px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg shadow-sm text-sm font-medium transition-all duration-150 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed; }
.btn-danger { @apply px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-md text-sm font-medium transition-all duration-150 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed; }
*/


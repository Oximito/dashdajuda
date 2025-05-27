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
  const [originalItemsBeforeEdit, setOriginalItemsBeforeEdit] = useState<Record<number, CardapioItem>>({}); // Guarda estado original

  // Estado inicial para o formulário de novo item
  const [novoItem, setNovoItem] = useState<Partial<Omit<CardapioItem, 'id'>>>({ 
    nome_produto: '',
    categoria: categoriasOrdem[0],
    disponivel: true,
    descricao_produto: '',
    observacao: '',
    promocao: '',
  });

  // **Refatoração Profunda #310: Função para garantir tipo e ordem**
  const processAndSortCardapioData = useCallback((data: any[] | null): CardapioItem[] => {
    const validItems = (data || []).map(item => ({
      id: item.id,
      categoria: typeof item.categoria === 'string' ? item.categoria : 'Outros',
      disponivel: typeof item.disponivel === 'boolean' ? item.disponivel : false,
      nome_produto: typeof item.nome_produto === 'string' ? item.nome_produto : 'Nome Inválido',
      descricao_produto: item.descricao_produto || null,
      observacao: item.observacao || null,
      promocao: item.promocao || null,
      isEditing: false, // Default
    }));

    return validItems.sort((a, b) => {
      const indexA = categoriasOrdem.indexOf(a.categoria);
      const indexB = categoriasOrdem.indexOf(b.categoria);
      if (indexA === -1 && indexB === -1) return a.nome_produto.localeCompare(b.nome_produto);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      if (indexA !== indexB) return indexA - indexB;
      return a.nome_produto.localeCompare(b.nome_produto);
    });
  }, []);

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
      setItensCardapio([]); // Limpa em caso de erro
    } else {
      const dadosOrdenados = processAndSortCardapioData(data);
      
      // **Refatoração Profunda #310: Atualização de estado mais segura**
      setItensCardapio(currentLocalItems => {
        const newItensMap = new Map<number, CardapioItem>();
        // Adiciona itens ordenados do banco
        dadosOrdenados.forEach(itemDB => {
          newItensMap.set(itemDB.id, itemDB);
        });
        // Sobrepõe com itens em edição local, mantendo o estado de edição e valores
        Object.keys(editedItems).forEach(idStr => {
          const id = parseInt(idStr, 10);
          const originalItem = originalItemsBeforeEdit[id]; // Pega o original guardado
          if (originalItem) { // Só restaura se tivermos o original
            const currentEditedValues = editedItems[id];
            // Mantém o estado de edição e aplica os valores editados sobre o original
            newItensMap.set(id, { ...originalItem, ...currentEditedValues, isEditing: true }); 
          }
        });
        // Retorna um novo array ordenado novamente (garantia extra)
        const finalArray = Array.from(newItensMap.values());
        return finalArray.sort((a, b) => {
            const indexA = categoriasOrdem.indexOf(a.categoria);
            const indexB = categoriasOrdem.indexOf(b.categoria);
            if (indexA === -1 && indexB === -1) return a.nome_produto.localeCompare(b.nome_produto);
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            if (indexA !== indexB) return indexA - indexB;
            return a.nome_produto.localeCompare(b.nome_produto);
        });
      });
      setError(null);
    }
    setLoading(false);
  }, [processAndSortCardapioData, editedItems, originalItemsBeforeEdit]); // Dependências revisadas

  // Efeito para buscar dados e configurar Realtime
  useEffect(() => {
    fetchItensCardapio('initial mount');

    const handleCardapioChanges = (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
      console.log("Mudança recebida do Supabase Realtime (Cárdapio)!", payload);
      // **Refatoração Profunda #310: Atualiza chamando fetchItensCardapio**
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
      // O Realtime deve atualizar a lista
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
      // O Realtime deve atualizar a lista
    }
  };

  // Ativa/desativa modo de edição para um item
  const toggleEditMode = (itemId: number) => {
    setItensCardapio(prevItens =>
      prevItens.map(item => {
        if (item.id === itemId) {
          if (!item.isEditing) {
            // Entrando no modo de edição: guarda o estado original
            setOriginalItemsBeforeEdit(prev => ({ ...prev, [itemId]: { ...item, isEditing: false } })); // Guarda sem isEditing
            setEditedItems(prev => ({ ...prev, [itemId]: {} })); // Inicia rastreamento de edições vazio
            return { ...item, isEditing: true };
          } else {
            // Saindo do modo de edição (cancelando): restaura o estado original
            const originalItemData = originalItemsBeforeEdit[itemId];
            setEditedItems(prev => {
                const newState = { ...prev };
                delete newState[itemId];
                return newState;
            });
            setOriginalItemsBeforeEdit(prev => {
                const newState = { ...prev };
                delete newState[itemId];
                return newState;
            });
            // Retorna o item original guardado (ou o item atual se algo falhar)
            return originalItemData ? { ...originalItemData, isEditing: false } : { ...item, isEditing: false }; 
          }
        }
        return item;
      })
    );
  };

  // Handler para mudanças nos inputs de edição
  const handleEditInputChange = (itemId: number, field: keyof CardapioItem, value: any) => {
    const finalValue = field === 'disponivel' ? (value === 'true') : value;
    // Atualiza apenas a cópia local que está sendo exibida
    setItensCardapio(prevItens =>
      prevItens.map(item =>
        item.id === itemId ? { ...item, [field]: finalValue } : item
      )
    );
    // Atualiza o objeto de alterações rastreadas
    setEditedItems(prev => ({
        ...prev,
        [itemId]: { ...(prev[itemId] || {}), [field]: finalValue }
    }));
  };

  // **Refatoração Profunda #310: useMemo para itens com alterações**
  const itemsComAlteracoes = useMemo(() => {
    return Object.keys(editedItems).filter(idStr => {
        const id = parseInt(idStr, 10);
        const itemAtualEditado = itensCardapio.find(i => i.id === id);
        const itemOriginal = originalItemsBeforeEdit[id]; // Pega o estado original guardado
        if (!itemAtualEditado || !itemOriginal || !itemAtualEditado.isEditing) return false;
        
        // Compara o estado atual editado com o original guardado
        // Verifica se algum campo rastreado em editedItems[id] é diferente do original
        const camposEditados = editedItems[id];
        return Object.keys(camposEditados).some(key => 
            camposEditados[key as keyof CardapioItem] !== itemOriginal[key as keyof CardapioItem]
        );
    }).map(idStr => itensCardapio.find(i => i.id === parseInt(idStr, 10))).filter(Boolean) as CardapioItem[];
  }, [itensCardapio, editedItems, originalItemsBeforeEdit]); // Dependências revisadas

  // Salva todas as alterações pendentes
  const handleSaveAllChanges = async () => {
    if (itemsComAlteracoes.length === 0) {
      alert("Nenhuma alteração para salvar.");
      return;
    }
    setSaving(true);
    const updates = itemsComAlteracoes.map(item => {
      const { id } = item;
      const updateData = editedItems[id]; // Pega apenas os campos que foram alterados
      if (!updateData || Object.keys(updateData).length === 0) return Promise.resolve({ error: null }); // Pula se não houver dados
      
      // Garante que apenas campos válidos sejam enviados
      const validUpdateData: Partial<Omit<CardapioItem, 'id' | 'isEditing'>> = {};
      Object.keys(updateData).forEach(key => {
          if (key !== 'id' && key !== 'isEditing') {
              validUpdateData[key as keyof typeof validUpdateData] = updateData[key as keyof typeof updateData];
          }
      });

      if (Object.keys(validUpdateData).length === 0) return Promise.resolve({ error: null }); // Pula se não houver campos válidos

      return supabase.from('Cárdapio').update(validUpdateData).match({ id });
    });

    try {
      const results = await Promise.all(updates);
      const errors = results.filter(result => result.error);
      if (errors.length > 0) {
        console.error("Erros ao salvar alterações:", errors);
        alert(`Houve ${errors.length} erro(s) ao salvar. Verifique o console.`);
      } else {
        alert("Todas as alterações foram salvas com sucesso!");
        // Sai do modo de edição para os itens salvos e limpa o rastreamento
        const savedIds = itemsComAlteracoes.map(i => i.id);
        setItensCardapio(prev => prev.map(item => savedIds.includes(item.id) ? {...item, isEditing: false} : item));
        setEditedItems({}); // Limpa todos os itens editados
        setOriginalItemsBeforeEdit({}); // Limpa os originais guardados
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

  // **Refatoração Profunda #310: useMemo para agrupamento, mais seguro**
  const groupedItens = useMemo(() => {
    console.log("Recalculando groupedItens...");
    const groups: Record<string, CardapioItem[]> = {};
    // Inicializa todos os grupos definidos na ordem correta
    categoriasOrdem.forEach(cat => { groups[cat] = []; });

    itensCardapio.forEach(item => {
      // Garante que a categoria é uma string válida e conhecida
      const categoriaKey = typeof item.categoria === 'string' && categoriasOrdem.includes(item.categoria) 
                           ? item.categoria 
                           : null; // Ignora categorias inválidas/desconhecidas por enquanto
      if (categoriaKey) {
        groups[categoriaKey].push(item);
      }
      // Poderia adicionar um grupo "Outros" se necessário, mas mantendo simples por ora
    });
    console.log("Grupos calculados:", groups);
    return groups;
  }, [itensCardapio]); // Depende apenas de itensCardapio

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

      {/* **CRÍTICO: RENDERIZAÇÃO DAS CATEGORIAS NA ORDEM CORRETA E SEMPRE** */}
      {categoriasOrdem.map(categoria => {
        // **Refatoração Profunda #310: Acessa grupo com segurança**
        const itensDaCategoria = groupedItens[categoria] ?? []; // Usa ?? para garantir array vazio
        
        return (
          <div key={categoria} className="mb-8">
            <h3 className="text-2xl font-semibold text-gray-600 mb-4 pb-2 border-b border-gray-200">{categoria}</h3>
            {itensDaCategoria.length === 0 ? (
              <p className="text-gray-500 italic ml-2">Nenhum item nesta categoria.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {itensDaCategoria.map(item => (
                  <div key={item.id} className={`card-base ${item.isEditing ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`}>
                    {/* Modo de Visualização */}
                    {!item.isEditing && (
                      <>
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="text-lg font-semibold text-gray-800 break-words text-center flex-grow">{item.nome_produto}</h4>
                          <span className={`ml-3 px-2.5 py-0.5 rounded-full text-xs font-medium ${item.disponivel ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.disponivel ? 'Disponível' : 'Indisponível'}
                          </span>
                        </div>
                        {(item.descricao_produto || item.observacao || item.promocao) && (
                          <div className="mt-3 pt-3 border-t border-gray-100 space-y-2 text-sm">
                            {item.descricao_produto && (
                              <div>
                                <strong className="text-gray-600">Descrição:</strong>
                                <p className="text-gray-700 whitespace-pre-wrap break-words text-justify">{item.descricao_produto}</p>
                              </div>
                            )}
                            {item.observacao && (
                              <div>
                                <strong className="text-gray-600">Observação:</strong>
                                <p className="text-gray-700 whitespace-pre-wrap break-words text-justify">{item.observacao}</p>
                              </div>
                            )}
                            {item.promocao && (
                              <div className="bg-pink-50 p-2 rounded-md border border-pink-100">
                                <strong className="text-pink-700">Promoção:</strong>
                                <p className="text-pink-800 whitespace-pre-wrap break-words text-justify">{item.promocao}</p>
                              </div>
                            )}
                          </div>
                        )}
                        {/* Botões de Ação (Visualização) */}
                        <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end space-x-2">
                          <button onClick={() => toggleEditMode(item.id)} className="btn-icon text-blue-600 hover:text-blue-800"><Edit3 size={18} /></button>
                          <button onClick={() => openDeleteConfirmationModal(item)} className="btn-icon text-red-600 hover:text-red-800"><Trash2 size={18} /></button>
                        </div>
                      </>
                    )}
                    {/* Modo de Edição */}
                    {item.isEditing && (
                      <div className="space-y-3">
                        <div>
                          <label htmlFor={`nome-${item.id}`} className="label-style">Nome</label>
                          <input 
                            type="text" 
                            id={`nome-${item.id}`} 
                            value={item.nome_produto}
                            onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)}
                            className="input-field"
                          />
                        </div>
                        <div>
                          <label htmlFor={`categoria-${item.id}`} className="label-style">Categoria</label>
                          <select 
                            id={`categoria-${item.id}`} 
                            value={item.categoria}
                            onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)}
                            className="input-field"
                          >
                            {categoriasOrdem.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`disponivel-${item.id}`} className="label-style">Disponível</label>
                          <select 
                            id={`disponivel-${item.id}`} 
                            value={item.disponivel.toString()}
                            onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value)}
                            className="input-field"
                          >
                            <option value="true">Sim</option>
                            <option value="false">Não</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor={`descricao-${item.id}`} className="label-style">Descrição</label>
                          <textarea 
                            id={`descricao-${item.id}`} 
                            value={item.descricao_produto || ''}
                            onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)}
                            className="input-field"
                            rows={3}
                          />
                        </div>
                        <div>
                          <label htmlFor={`observacao-${item.id}`} className="label-style">Observação</label>
                          <textarea 
                            id={`observacao-${item.id}`} 
                            value={item.observacao || ''}
                            onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)}
                            className="input-field"
                            rows={2}
                          />
                        </div>
                        <div>
                          <label htmlFor={`promocao-${item.id}`} className="label-style">Promoção</label>
                          <textarea 
                            id={`promocao-${item.id}`} 
                            value={item.promocao || ''}
                            onChange={(e) => handleEditInputChange(item.id, 'promocao', e.target.value)}
                            className="input-field"
                            rows={2}
                          />
                        </div>
                        {/* Botões de Ação (Edição) */}
                        <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end space-x-2">
                          <button onClick={() => toggleEditMode(item.id)} className="btn-secondary">
                            <XCircle size={18} className="mr-1"/> Cancelar
                          </button>
                          {/* Botão Salvar Individual (opcional, pode ser removido se usar apenas Salvar Todos) */}
                          {/* <button onClick={() => handleSaveChanges(item.id)} className="btn-primary bg-blue-600 hover:bg-blue-700">Salvar</button> */}
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

      {/* Modal Adicionar Novo Item - Estilo revisado */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-800">Adicionar Novo Item ao Cardápio</h3>
            </div>
            <form onSubmit={handleAddNewItem} className="flex flex-col flex-grow">
              <div className="p-6 overflow-y-auto flex-grow space-y-4">
                <div>
                  <label htmlFor="novo-nome" className="label-style">Nome do Produto <span className="text-red-500">*</span></label>
                  <input type="text" id="novo-nome" name="nome_produto" value={novoItem.nome_produto} onChange={handleNovoItemInputChange} className="input-field" required />
                </div>
                <div>
                  <label htmlFor="novo-categoria" className="label-style">Categoria <span className="text-red-500">*</span></label>
                  <select id="novo-categoria" name="categoria" value={novoItem.categoria} onChange={handleNovoItemInputChange} className="input-field" required>
                    {categoriasOrdem.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="novo-disponivel" className="label-style">Disponível?</label>
                  <select id="novo-disponivel" name="disponivel" value={novoItem.disponivel?.toString()} onChange={handleNovoItemDisponivelChange} className="input-field">
                    <option value="true">Sim</option>
                    <option value="false">Não</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="novo-descricao" className="label-style">Descrição</label>
                  <textarea id="novo-descricao" name="descricao_produto" value={novoItem.descricao_produto || ''} onChange={handleNovoItemInputChange} className="input-field" rows={3}></textarea>
                </div>
                <div>
                  <label htmlFor="novo-observacao" className="label-style">Observação</label>
                  <textarea id="novo-observacao" name="observacao" value={novoItem.observacao || ''} onChange={handleNovoItemInputChange} className="input-field" rows={2}></textarea>
                </div>
                <div>
                  <label htmlFor="novo-promocao" className="label-style">Promoção</label>
                  <textarea id="novo-promocao" name="promocao" value={novoItem.promocao || ''} onChange={handleNovoItemInputChange} className="input-field" rows={2}></textarea>
                </div>
              </div>
              <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3 rounded-b-xl">
                <button type="button" onClick={() => setIsAddModalOpen(false)} disabled={saving} className="btn-secondary">
                  <XCircle size={18} className="mr-1"/> Cancelar
                </button>
                <button type="submit" disabled={saving} className="btn-primary bg-green-600 hover:bg-green-700 focus:ring-green-400">
                  {saving ? <Loader2 size={18} className="mr-1 animate-spin"/> : <PlusCircle size={18} className="mr-1"/>}
                  {saving ? 'Adicionando...' : 'Adicionar Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmar Exclusão - Estilo Mantido */}
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


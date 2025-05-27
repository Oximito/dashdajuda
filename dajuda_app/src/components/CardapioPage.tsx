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
      setItensCardapio([]); // Limpa em caso de erro
    } else {
      const dadosDoBanco = (data || []) as CardapioItem[];
      
      // Ordena os dados recebidos pela ordem definida em categoriasOrdem
      const dadosOrdenados = dadosDoBanco.sort((a, b) => {
        const indexA = categoriasOrdem.indexOf(a.categoria);
        const indexB = categoriasOrdem.indexOf(b.categoria);
        if (indexA === -1 && indexB === -1) return a.nome_produto.localeCompare(b.nome_produto);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        if (indexA !== indexB) return indexA - indexB;
        return a.nome_produto.localeCompare(b.nome_produto);
      });
      
      // **Refatoração para evitar erro #310: Atualização mais segura do estado**
      // Mescla dados do banco com edições locais não salvas
      setItensCardapio(currentLocalItems => {
        const newItensMap = new Map<number, CardapioItem>();
        // Primeiro, adiciona os itens ordenados do banco
        dadosOrdenados.forEach(itemDB => {
          newItensMap.set(itemDB.id, { ...itemDB, isEditing: false });
        });
        // Depois, sobrepõe com os itens que estão sendo editados localmente
        Object.keys(editedItems).forEach(idStr => {
          const id = parseInt(idStr, 10);
          const currentLocalItem = currentLocalItems.find(item => item.id === id);
          if (currentLocalItem && currentLocalItem.isEditing) {
            // Mantém o estado de edição e os valores editados
            newItensMap.set(id, { ...currentLocalItem, ...editedItems[id] }); 
          }
        });
        // Retorna um novo array a partir do mapa
        return Array.from(newItensMap.values());
      });
      setError(null);
    }
    setLoading(false);
  }, [editedItems]); // Dependência mantida

  // Efeito para buscar dados e configurar Realtime
  useEffect(() => {
    fetchItensCardapio('initial mount');

    const handleCardapioChanges = (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
      console.log("Mudança recebida do Supabase Realtime (Cárdapio)!", payload);
      // **Refatoração para evitar erro #310: Atualiza chamando fetchItensCardapio**
      // A função fetchItensCardapio já lida com a preservação das edições
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
      // O Realtime deve atualizar a lista, chamando fetchItensCardapio
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
            // Entrando no modo de edição: guarda o estado original para comparação
            setEditedItems(prev => ({ ...prev, [itemId]: { ...item } })); // Guarda o estado *antes* de editar
            return { ...item, isEditing: true };
          } else {
            // Saindo do modo de edição (cancelando): restaura o estado original
            const originalItemData = editedItems[itemId]; // Pega o estado guardado
            setEditedItems(prev => {
                const newState = { ...prev };
                delete newState[itemId]; // Para de rastrear
                return newState;
            });
            // Retorna o item com os dados originais guardados
            return { ...(originalItemData || item), isEditing: false } as CardapioItem; 
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
    // Atualiza o objeto de alterações rastreadas (sem modificar o original guardado)
    setEditedItems(prev => ({
        ...prev,
        [itemId]: { ...(prev[itemId] || {}), [field]: finalValue }
    }));
  };

  // Calcula quais itens têm alterações pendentes comparando com o estado original guardado
  const itemsComAlteracoes = useMemo(() => {
    return Object.keys(editedItems).filter(idStr => {
        const id = parseInt(idStr, 10);
        const itemAtualEditado = itensCardapio.find(i => i.id === id);
        const itemOriginal = editedItems[id]; // O estado original guardado
        if (!itemAtualEditado || !itemOriginal || !itemAtualEditado.isEditing) return false;
        
        // Compara o estado atual editado com o original guardado
        return Object.keys(itemOriginal).some(key => 
            key !== 'isEditing' && 
            itemAtualEditado[key as keyof CardapioItem] !== itemOriginal[key as keyof CardapioItem]
        );
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
      const updateData: Partial<Omit<CardapioItem, 'id' | 'isEditing'>> = {
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
        // Sai do modo de edição para os itens salvos e limpa o rastreamento
        setItensCardapio(prev => prev.map(item => itemsComAlteracoes.find(i => i.id === item.id) ? {...item, isEditing: false} : item));
        setEditedItems({}); // Limpa todos os itens editados
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
  // **Refatoração para evitar erro #310: Simplificando useMemo**
  const groupedItens = useMemo(() => {
    console.log("Recalculando groupedItens..."); // Debug
    const groups: Record<string, CardapioItem[]> = {};
    categoriasOrdem.forEach(cat => { groups[cat] = []; });
    itensCardapio.forEach(item => {
      // Garante que a categoria é uma string válida antes de agrupar
      const categoriaKey = typeof item.categoria === 'string' && categoriasOrdem.includes(item.categoria) 
                           ? item.categoria 
                           : "Outros"; // Agrupa categorias inválidas ou desconhecidas
      if (!groups[categoriaKey]) groups[categoriaKey] = []; // Garante que o grupo exista
      groups[categoriaKey].push(item);
    });
    // Adiciona o grupo "Outros" se ele foi criado
    if (!categoriasOrdem.includes("Outros") && groups["Outros"]?.length > 0) {
        // Não adiciona à ordem principal, mas o grupo existe
    } else if (!groups["Outros"]) {
        delete groups["Outros"]; // Remove se não foi usado
    }
    console.log("Grupos calculados:", groups); // Debug
    return groups;
  }, [itensCardapio]); // Dependência mantida

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

      {/* **CRÍTICO: RENDERIZAÇÃO DAS CATEGORIAS NA ORDEM CORRETA** */}
      {categoriasOrdem.map(categoria => {
        // **Refatoração para evitar erro #310: Acessa grupo com segurança**
        const itensDaCategoria = groupedItens[categoria] ?? []; // Usa ?? para garantir array vazio
        
        return (
          // **Refatoração para evitar erro #310: Usa categoria como key (estável)**
          <div key={categoria} className="mb-10">
            <h3 className="text-2xl font-semibold text-gray-800 mb-4 pb-2 border-b border-gray-200">{categoria}</h3>
            {itensDaCategoria.length === 0 ? (
              <p className="text-gray-500 italic ml-2">Nenhum item nesta categoria.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {itensDaCategoria.map(item => (
                  // **Refatoração para evitar erro #310: Usa item.id como key (estável e único)**
                  <div key={item.id} className={`card-base ${item.isEditing ? 'ring-2 ring-blue-400 ring-offset-1' : ''}`}>
                    {!item.isEditing ? (
                      // MODO VISUALIZAÇÃO
                      <div className="flex flex-col h-full">
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="text-lg font-semibold text-gray-900 break-words flex-grow mr-2">{item.nome_produto}</h4>
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${item.disponivel ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {item.disponivel ? 'Disponível' : 'Indisponível'}
                          </span>
                        </div>
                        {item.descricao_produto && <p className="text-sm text-gray-600 mb-1 mt-1 break-words"><strong className='text-gray-700'>Descrição:</strong> {item.descricao_produto}</p>}
                        {item.observacao && <p className="text-sm text-gray-600 mb-1 mt-1 break-words"><strong className='text-gray-700'>Observação:</strong> {item.observacao}</p>}
                        {item.promocao && <p className="text-sm text-pink-700 bg-pink-50 p-2 rounded-md mt-2 break-words"><strong className='font-semibold'>Promoção:</strong> {item.promocao}</p>}
                        <div className="flex-grow"></div> 
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
                          </select>
                        </div>
                        <div className="flex justify-end space-x-2 pt-2 border-t border-gray-100">
                          <button onClick={() => toggleEditMode(item.id)} className="btn-secondary text-sm"><XCircle size={16} className='mr-1'/> Cancelar</button>
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
      
      {/* Modal Adicionar Item - Estilo "Apple" */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <form onSubmit={handleAddNewItem} className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-800">Adicionar Novo Item ao Cardápio</h3>
            </div>
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

      {/* Modal de Confirmação de Exclusão */}
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


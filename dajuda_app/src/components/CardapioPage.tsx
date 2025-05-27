import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { PlusCircle, Save, XCircle, Trash2, Edit3, AlertTriangle, Loader2, Info } from 'lucide-react'; // Removed CheckCircle
import type { RealtimeChannel } from "@supabase/supabase-js";

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

// Type guard para verificar se um objeto tem a propriedade 'id'
function hasId(obj: any): obj is { id: number } {
  return typeof obj === 'object' && obj !== null && typeof obj.id === 'number';
}

// Função auxiliar para mapear dados do Supabase para o formato do estado
const mapSupabaseItemToState = (item: any): CardapioItem => ({
  id: item?.id || 0,
  nome_produto: item?.nome_produto || '',
  categoria: item?.categoria || '',
  disponivel: item?.disponivel === 'Sim' || item?.disponivel === true ? 'Sim' : 'Não',
  descricao_produto: item?.descricao_produto || '',
  observacao: item?.observacao || '',
  promocoes: item?.promocoes || '',
});

// --- Redesign Styles v2 ---
const baseInputStyle = "block w-full text-sm rounded-md border focus:outline-none focus:ring-2 transition duration-150 ease-in-out shadow-sm"; // Slightly softer radius, added shadow
const inputStyle = `${baseInputStyle} border-gray-300 focus:border-pink-500 focus:ring-pink-300 placeholder-gray-400 px-3 py-2`;
const labelStyle = "block text-sm font-medium text-gray-700 mb-1.5"; // Increased bottom margin
const baseButtonStyle = "inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 transition duration-150 ease-in-out disabled:opacity-60 disabled:cursor-not-allowed transform hover:scale-105 active:scale-95"; // Softer radius, added transform effects
const secondaryButtonStyle = `${baseButtonStyle} text-gray-700 bg-white border-gray-300 hover:bg-gray-50 focus:ring-pink-500`;
const dangerButtonStyle = `${baseButtonStyle} text-white bg-red-600 hover:bg-red-700 focus:ring-red-500`;
const greenButtonStyle = `${baseButtonStyle} text-white bg-green-600 hover:bg-green-700 focus:ring-green-500`;
const blueButtonStyle = `${baseButtonStyle} text-white bg-blue-600 hover:bg-blue-700 focus:ring-blue-500`;
const cardBaseStyle = "bg-white rounded-lg shadow-sm overflow-hidden transition-all duration-200 ease-in-out hover:shadow-md flex flex-col"; // Softer radius, lighter shadow, flex-col for button alignment
const cardEditingStyle = `${cardBaseStyle} ring-2 ring-pink-400 ring-offset-1`;
const modalOverlayStyle = "fixed inset-0 bg-gray-900 bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4";
const modalContentStyle = "bg-white p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"; // Softer radius
const sectionTitleStyle = "text-xl font-semibold text-gray-800 mb-5 pb-2 border-b border-gray-200"; // Increased bottom margin
const availabilityBadgeBase = "inline-block px-2.5 py-0.5 rounded-full text-xs font-medium"; // Slightly larger padding
const availableBadgeStyle = `${availabilityBadgeBase} bg-green-100 text-green-800`;
const unavailableBadgeStyle = `${availabilityBadgeBase} bg-red-100 text-red-800`;
const promotionBoxStyle = "mt-3 p-3 bg-pink-50 border border-pink-200 rounded-md text-xs"; // New pink theme
const saveChangesBannerStyle = "bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg mb-6 flex flex-col sm:flex-row justify-between items-center gap-4"; // New blue theme, removed fixed/sticky
// --- End Redesign Styles v2 ---

const CardapioPage: React.FC = () => {
  const [itensCardapio, setItensCardapio] = useState<CardapioItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [isConfirmDeleteModalOpen, setIsConfirmDeleteModalOpen] = useState<boolean>(false);
  const [itemToDelete, setItemToDelete] = useState<CardapioItem | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const cardapioChannelRef = useRef<RealtimeChannel | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<number>(0);
  const [editingItemIds, setEditingItemIds] = useState<Set<number>>(new Set());

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
      setRealtimeError(`Falha ao carregar cardápio: ${fetchError.message}`);
      setItensCardapio([]);
    } else {
      const mappedData = data.map(mapSupabaseItemToState);
      setItensCardapio(mappedData);
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

    const handleRealtimeChange = (payload: any) => {
        console.log("[CardapioPage] Mudança Realtime recebida:", payload);
        if (typeof payload.eventType !== 'string') {
            console.warn("[CardapioPage] Evento Realtime sem eventType válido:", payload);
            return;
        }

        setItensCardapio(currentItems => {
            let updatedItems = [...currentItems];
            let recordId: number | undefined = undefined;
            if (hasId(payload.new)) {
                recordId = payload.new.id;
            } else if (hasId(payload.old)) {
                recordId = payload.old.id;
            }

            if (recordId === undefined) {
                console.warn("[CardapioPage] Evento Realtime sem ID identificável:", payload);
                return currentItems;
            }

            switch (payload.eventType) {
                case 'INSERT':
                    if (!updatedItems.some(item => item.id === recordId)) {
                        updatedItems.push(mapSupabaseItemToState(payload.new));
                        console.log(`[CardapioPage] Item ${recordId} inserido via Realtime.`);
                    }
                    break;
                case 'UPDATE':
                    const isLocallyEditing = editingItemIds.has(recordId);
                    if (isLocallyEditing) {
                        console.log(`[CardapioPage] Item ${recordId} ignorado na atualização Realtime (está em edição local).`);
                    } else {
                        updatedItems = updatedItems.map(item => {
                            if (item.id === recordId) {
                                console.log(`[CardapioPage] Item ${recordId} atualizado via Realtime.`);
                                return mapSupabaseItemToState(payload.new);
                            }
                            return item;
                        });
                    }
                    break;
                case 'DELETE':
                    updatedItems = updatedItems.filter(item => item.id !== recordId);
                    console.log(`[CardapioPage] Item ${recordId} removido via Realtime.`);
                    if (editingItemIds.has(recordId)) {
                        setEditingItemIds(prevIds => {
                            const newIds = new Set(prevIds);
                            newIds.delete(recordId!);
                            return newIds;
                        });
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
        setRealtimeError(null);
        retryCountRef.current = 0;
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
        fetchItensCardapio('after subscribe');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        console.error(`[CardapioPage] Erro/Status no canal Realtime: ${status}`, err);
        cardapioChannelRef.current = null;
        if (!retryTimeoutRef.current || status === 'CHANNEL_ERROR') {
            const baseMessage = `Erro de conexão em tempo real (Cardápio): ${status}`;
            const errorMessage = err ? `${baseMessage} - ${err.message}` : baseMessage;
            if (retryCountRef.current >= MAX_RETRIES) {
                console.error("[CardapioPage] Máximo de tentativas de reconexão atingido.");
                setRealtimeError("Falha ao reconectar ao serviço de atualizações em tempo real (Cardápio) após múltiplas tentativas. Atualize manualmente.");
            } else {
                setRealtimeError(`${errorMessage}. Tentando reconectar...`);
                const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCountRef.current);
                console.log(`[CardapioPage] Tentando reconectar em ${delay / 1000} segundos... (Tentativa ${retryCountRef.current + 1}/${MAX_RETRIES})`);
                retryTimeoutRef.current = setTimeout(() => {
                    retryCountRef.current++;
                    retryTimeoutRef.current = null;
                    setupRealtimeSubscription();
                }, delay);
            }
        } else {
            console.log(`[CardapioPage] Status ${status} recebido, mas já existe uma tentativa de reconexão em andamento.`);
        }
      }
    });
    cardapioChannelRef.current = channel;
  }, [fetchItensCardapio, editingItemIds]);

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
      setEditingItemIds(prevIds => {
          const newIds = new Set(prevIds);
          newIds.delete(itemToDelete.id);
          return newIds;
      });
    }
  };

  const toggleEditMode = (itemId: number) => {
    setItensCardapio(prevItens =>
      prevItens.map(item => {
        if (item.id === itemId) {
          if (!item.isEditing) {
            setEditingItemIds(prevIds => new Set(prevIds).add(itemId));
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
            setEditingItemIds(prevIds => {
                const newIds = new Set(prevIds);
                newIds.delete(itemId);
                return newIds;
            });
            return {
              ...item,
              isEditing: false,
              nome_produto: item.originalNome !== undefined ? item.originalNome : item.nome_produto,
              categoria: item.originalCategoria !== undefined ? item.originalCategoria : item.categoria,
              disponivel: item.originalDisponivel !== undefined ? item.originalDisponivel : item.disponivel,
              descricao_produto: item.originalDescricao !== undefined ? item.originalDescricao : item.descricao_produto,
              observacao: item.originalObservacao !== undefined ? item.originalObservacao : item.observacao,
              promocoes: item.originalPromocoes !== undefined ? item.originalPromocoes : item.promocoes,
              originalNome: undefined,
              originalCategoria: undefined,
              originalDisponivel: undefined,
              originalDescricao: undefined,
              originalObservacao: undefined,
              originalPromocoes: undefined,
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

  const handleSaveAllChanges = async () => {
    const itensParaSalvar = itensCardapio.filter(item => editingItemIds.has(item.id));
    if (itensParaSalvar.length === 0) {
      alert("Nenhuma alteração para salvar.");
      return;
    }
    const itensInvalidos = itensParaSalvar.filter(item => !item.nome_produto.trim() || !item.categoria.trim());
    if (itensInvalidos.length > 0) {
        alert(`Os seguintes itens não podem ser salvos porque o nome do produto e a categoria são obrigatórios: IDs ${itensInvalidos.map(i => i.id).join(', ')}`);
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
      const savedIds = new Set(itensParaSalvar.map(item => item.id));
      setItensCardapio(prevItens =>
        prevItens.map(item =>
          savedIds.has(item.id)
            ? { ...item, isEditing: false, originalNome: undefined, originalCategoria: undefined, originalDisponivel: undefined, originalDescricao: undefined, originalObservacao: undefined, originalPromocoes: undefined }
            : item
        )
      );
      setEditingItemIds(prevIds => {
          const newIds = new Set(prevIds);
          savedIds.forEach(id => newIds.delete(id));
          return newIds;
      });
    }
  };

  const itensAgrupados = useMemo(() => {
    const grupos: { [key: string]: CardapioItem[] } = {};
    categoriasDefinidas.forEach(cat => grupos[cat] = []);
    itensCardapio.forEach(item => {
      const categoria = item.categoria || "Sem Categoria";
      if (!grupos[categoria]) {
        grupos[categoria] = [];
      }
      grupos[categoria].push(item);
    });
    Object.keys(grupos).forEach(categoria => {
      grupos[categoria].sort((a, b) => (a.nome_produto || '').localeCompare(b.nome_produto || ''));
    });
    return grupos;
  }, [itensCardapio]);

  return (
    <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-center mb-8 pb-4 border-b border-gray-200">
        <h1 className="text-2xl font-semibold text-gray-900 mb-4 sm:mb-0">Cardápio</h1>
        <button
          onClick={() => setIsAddModalOpen(true)}
          className={greenButtonStyle}
        >
          <PlusCircle size={18} className="mr-2" /> Adicionar Item
        </button>
      </div>

      {/* Realtime Error Banner */}
      {realtimeError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg relative mb-6 flex items-center" role="alert">
          <AlertTriangle size={20} className="text-red-500 mr-3 flex-shrink-0" />
          <div>
            <strong className="font-semibold">Erro de Conexão: </strong>
            <span className="block sm:inline text-sm">{realtimeError}</span>
          </div>
        </div>
      )}

      {/* Save Changes Banner - Now scrolls with page */}
      {editingItemIds.size > 0 && (
        <div className={saveChangesBannerStyle}>
          <div className="flex items-center">
             <Info size={20} className="text-blue-600 mr-3 flex-shrink-0" /> {/* Changed icon */}
             <div>
                <p className="font-semibold">Você tem {editingItemIds.size} item(ns) em edição.</p>
                <p className="text-sm">Salve as alterações para aplicá-las.</p>
             </div>
          </div>
          <button
            onClick={handleSaveAllChanges}
            disabled={saving}
            className={blueButtonStyle}
          >
            {saving ? <Loader2 size={18} className="mr-1 animate-spin" /> : <Save size={18} className="mr-1" />}
            {saving ? 'Salvando...' : 'Salvar Alterações'}
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="text-center py-16">
          <Loader2 size={32} className="animate-spin text-pink-600 mx-auto" />
          <p className="mt-3 text-sm text-gray-500">Carregando cardápio...</p>
        </div>
      ) : (
        // Main Content Grid
        <div className="space-y-12">
          {categoriasDefinidas.map(categoria => {
            const itensDaCategoria = itensAgrupados[categoria] || [];
            if (itensDaCategoria.length > 0) {
              return (
                <section key={categoria}>
                  <h2 className={sectionTitleStyle}>{categoria}</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {itensDaCategoria.map(item => (
                      <div key={item.id} className={item.isEditing ? cardEditingStyle : cardBaseStyle}>
                        {/* Card Content - View Mode */}
                        {!item.isEditing && (
                          <div className="p-5 flex flex-col flex-grow"> {/* Added flex-grow */}
                            <div className="flex-grow mb-4"> {/* Content grows */}
                              <h3 className="text-lg font-semibold text-gray-900 mb-1.5 truncate" title={item.nome_produto}>{item.nome_produto || "(Item sem nome)"}</h3>
                              <span className={item.disponivel === 'Sim' ? availableBadgeStyle : unavailableBadgeStyle}>
                                {item.disponivel === 'Sim' ? 'Disponível' : 'Indisponível'}
                              </span>
                              {item.descricao_produto && <p className="text-sm text-gray-600 mt-2.5 line-clamp-3">{item.descricao_produto}</p>}
                              {item.promocoes && (
                                  <div className={promotionBoxStyle}>
                                      <p className="font-semibold text-pink-800">Promoção:</p>
                                      <p className="text-pink-700">{item.promocoes}</p>
                                  </div>
                              )}
                              {item.observacao && <p className="text-xs text-gray-500 mt-2.5 italic">Obs: {item.observacao}</p>}
                            </div>
                            {/* Buttons aligned to bottom */}
                            <div className="mt-auto pt-4 border-t border-gray-100 flex justify-end space-x-2"> {/* Added mt-auto */}
                              <button
                                onClick={() => toggleEditMode(item.id)}
                                className={`${secondaryButtonStyle} px-3 py-1.5`}
                                title="Editar Item"
                              >
                                <Edit3 size={16} />
                              </button>
                              <button
                                onClick={() => openDeleteConfirmationModal(item)}
                                className={`${dangerButtonStyle} px-3 py-1.5`}
                                title="Excluir Item"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        )}
                        {/* Card Content - Edit Mode */}
                        {item.isEditing && (
                          <div className="p-5">
                            <div className="space-y-4">
                              <div>
                                <label htmlFor={`nome-${item.id}`} className={labelStyle}>Nome*</label>
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
                                <label htmlFor={`categoria-${item.id}`} className={labelStyle}>Categoria*</label>
                                <select
                                  id={`categoria-${item.id}`}
                                  value={item.categoria}
                                  onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)}
                                  className={inputStyle}
                                  required
                                >
                                  {categoriasDefinidas.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                  {!categoriasDefinidas.includes(item.categoria) && item.categoria && (
                                    <option value={item.categoria}>{item.categoria} (Outra)</option>
                                  )}
                                </select>
                              </div>
                              <div>
                                <label htmlFor={`disponivel-${item.id}`} className={labelStyle}>Disponível*</label>
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
                              <div className="flex justify-end space-x-2 pt-2">
                                <button onClick={() => toggleEditMode(item.id)} className={secondaryButtonStyle}>
                                  <XCircle size={16} className="mr-1" /> Cancelar
                                </button>
                                {/* Salvar individual removido - usar Salvar Alterações geral */}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              );
            }
            return null;
          })}
          {/* Seção para itens sem categoria definida */} 
          {(itensAgrupados["Sem Categoria"]?.length > 0) && (
              <section key="Sem Categoria">
                  <h2 className={sectionTitleStyle}>Sem Categoria</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {itensAgrupados["Sem Categoria"].map(item => (
                          <div key={item.id} className={item.isEditing ? cardEditingStyle : cardBaseStyle}>
                             {/* Repete a lógica de renderização do item - View Mode */}
                            {!item.isEditing && (
                              <div className="p-5 flex flex-col flex-grow"> {/* Added flex-grow */}
                                <div className="flex-grow mb-4"> {/* Content grows */}
                                  <h3 className="text-lg font-semibold text-gray-900 mb-1.5 truncate" title={item.nome_produto}>{item.nome_produto || "(Item sem nome)"}</h3>
                                  <span className={item.disponivel === 'Sim' ? availableBadgeStyle : unavailableBadgeStyle}>
                                    {item.disponivel === 'Sim' ? 'Disponível' : 'Indisponível'}
                                  </span>
                                  {/* Outros detalhes... */}
                                </div>
                                {/* Buttons aligned to bottom */}
                                <div className="mt-auto pt-4 border-t border-gray-100 flex justify-end space-x-2"> {/* Added mt-auto */}
                                  <button onClick={() => toggleEditMode(item.id)} className={`${secondaryButtonStyle} px-3 py-1.5`} title="Editar Item"><Edit3 size={16} /></button>
                                  <button onClick={() => openDeleteConfirmationModal(item)} className={`${dangerButtonStyle} px-3 py-1.5`} title="Excluir Item"><Trash2 size={16} /></button>
                                </div>
                              </div>
                            )}
                            {/* Repete a lógica de renderização do item - Edit Mode */}
                            {item.isEditing && (
                              <div className="p-5">
                                <div className="space-y-4">
                                  {/* Campos de edição aqui... */}
                                  <p>Editando item sem categoria ID: {item.id}</p>
                                  <div className="flex justify-end space-x-2 pt-2">
                                    <button onClick={() => toggleEditMode(item.id)} className={secondaryButtonStyle}><XCircle size={16} className="mr-1" /> Cancelar</button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                      ))}
                  </div>
              </section>
          )}
        </div>
      )}

      {/* Add New Item Modal */} 
      {isAddModalOpen && (
        <div className={modalOverlayStyle}>
          <div className={modalContentStyle}>
            <h3 className="text-xl font-semibold mb-6 text-gray-900">Adicionar Novo Item</h3>
            <form onSubmit={handleAddNewItem} className="space-y-4">
               <div>
                <label htmlFor="novo-nome" className={labelStyle}>Nome do Produto*</label>
                <input id="novo-nome" type="text" name="nome_produto" value={novoItem.nome_produto} onChange={handleNovoItemInputChange} className={inputStyle} required />
              </div>
              <div>
                <label htmlFor="novo-categoria" className={labelStyle}>Categoria*</label>
                <select id="novo-categoria" name="categoria" value={novoItem.categoria} onChange={handleNovoItemInputChange} className={inputStyle} required>
                  {categoriasDefinidas.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="novo-disponivel" className={labelStyle}>Disponível*</label>
                <select id="novo-disponivel" name="disponivel" value={novoItem.disponivel} onChange={handleNovoItemInputChange} className={inputStyle}>
                  <option value="Sim">Sim</option>
                  <option value="Não">Não</option>
                </select>
              </div>
              <div>
                <label htmlFor="novo-descricao" className={labelStyle}>Descrição</label>
                <textarea id="novo-descricao" name="descricao_produto" value={novoItem.descricao_produto} onChange={handleNovoItemInputChange} rows={3} className={inputStyle} />
              </div>
              <div>
                <label htmlFor="novo-promocoes" className={labelStyle}>Promoções</label>
                <textarea id="novo-promocoes" name="promocoes" value={novoItem.promocoes || ''} onChange={handleNovoItemInputChange} rows={2} className={inputStyle} placeholder="Ex: Leve 3 Pague 2" />
              </div>
              <div>
                <label htmlFor="novo-observacao" className={labelStyle}>Observação Interna</label>
                <textarea id="novo-observacao" name="observacao" value={novoItem.observacao} onChange={handleNovoItemInputChange} rows={2} className={inputStyle} placeholder="Ex: Contém glúten" />
              </div>
              <div className="flex justify-end space-x-3 pt-5 border-t border-gray-200 mt-6">
                <button type="button" onClick={() => setIsAddModalOpen(false)} disabled={saving} className={secondaryButtonStyle}>
                  Cancelar
                </button>
                <button type="submit" disabled={saving} className={greenButtonStyle}>
                  {saving ? <Loader2 size={18} className="mr-1 animate-spin" /> : <PlusCircle size={18} className="mr-1" />}
                  {saving ? 'Adicionando...' : 'Adicionar Item'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */} 
      {isConfirmDeleteModalOpen && (
        <div className={modalOverlayStyle}>
          <div className={`${modalContentStyle} max-w-md`}>
            <div className="text-center">
              <AlertTriangle size={40} className="text-red-500 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2 text-gray-900">Confirmar Exclusão</h3>
              <p className="text-sm text-gray-600 mb-6">
                Tem certeza que deseja excluir "<strong>{itemToDelete?.nome_produto || 'este item'}</strong>"?
                <br />Esta ação não pode ser desfeita.
              </p>
            </div>
            <div className="flex justify-center space-x-3">
              <button onClick={() => setIsConfirmDeleteModalOpen(false)} disabled={saving} className={secondaryButtonStyle}>
                Cancelar
              </button>
              <button onClick={handleDeleteItem} disabled={saving} className={dangerButtonStyle}>
                {saving ? <Loader2 size={18} className="mr-1 animate-spin" /> : <Trash2 size={18} className="mr-1" />}
                {saving ? 'Excluindo...' : 'Sim, Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CardapioPage;


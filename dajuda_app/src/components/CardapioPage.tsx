import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../supabaseClient';
// Restaurando ícones corretos e removendo não utilizados
import { PlusCircle, Save, XCircle, Trash2, Edit3, AlertTriangle, Loader2 } from 'lucide-react'; 
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// Interface para o item do cardápio - Mantida
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

// **URGENTE: CORRIGINDO A ORDEM E COMPLETUDE DAS CATEGORIAS**
const categoriasOrdem = [
  "Marmita do dia",
  "Marmita clássica",
  "Omelete", // Adicionando Omelete que estava faltando
  "Mix de salada",
  "Bebida", // Corrigido para "Bebida" (singular)
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
  const [editedItems, setEditedItems] = useState<Record<number, Partial<CardapioItem>>>({}); // Rastreia edições

  // Estado inicial para o formulário de novo item
  const [novoItem, setNovoItem] = useState<Partial<Omit<CardapioItem, 'id'>>>({ 
    nome_produto: '',
    categoria: categoriasOrdem[0], // Usa a ordem definida
    disponivel: true,
    descricao_produto: '',
    observacao: '',
    promocao: '',
  });

  // Busca itens do cardápio, com tratamento de erro e ordenação CORRIGIDA
  const fetchItensCardapio = useCallback(async (source?: string) => {
    console.log(`Buscando itens do cardápio... (Origem: ${source || 'desconhecida'})`);
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('Cárdapio') // Nome correto da tabela
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
        // Coloca categorias desconhecidas no final
        if (indexA === -1 && indexB === -1) return a.nome_produto.localeCompare(b.nome_produto);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        // Ordena pela categoria e depois pelo nome do produto
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
                // Se estava sendo editado, mantém o estado editado
                return mapaEditados[itemDB.id];
            } else {
                // Caso contrário, usa o dado do banco
                return { ...itemDB, isEditing: false };
            }
        });
      });
      setError(null); // Limpa erro se a busca for bem-sucedida
    }
    setLoading(false);
  }, [editedItems]); // Adiciona editedItems como dependência

  // Efeito para buscar dados e configurar Realtime
  useEffect(() => {
    fetchItensCardapio('initial mount');

    const handleCardapioChanges = (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
      console.log("Mudança recebida do Supabase Realtime (Cárdapio)!", payload);
      // Busca novamente para refletir mudanças, preservando edições locais
      fetchItensCardapio('realtime update'); 
    };

    // Configuração do canal Realtime
    cardapioChannelRef.current = supabase
      .channel('cardapio_realtime_channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'Cárdapio' },
        handleCardapioChanges
      )
      .subscribe((status, err) => {
        // Tratamento de status da conexão Realtime
        if (status === 'SUBSCRIBED') {
          console.log('Conectado ao canal Realtime do Cardapio!');
          setError(prevError => prevError?.includes('(Cárdapio)') ? null : prevError); // Limpa erro específico do cardápio
        } else if (status === 'CHANNEL_ERROR') {
          console.error('Erro no canal Realtime do Cardapio:', err);
          setError(`Erro de conexão em tempo real (Cárdapio): ${err?.message || 'Erro desconhecido'}`);
        } else if (status === 'TIMED_OUT') {
          console.warn('Timeout na conexão Realtime do Cardapio.');
          setError('Conexão em tempo real (Cárdapio) expirou. As atualizações podem não ser instantâneas.');
        } else if (status === 'CLOSED'){
          console.log('Canal Realtime (Cárdapio) fechado.');
          // Poderia adicionar lógica de reconexão aqui se necessário
        }
      });

    // Limpeza ao desmontar o componente
    return () => {
      if (cardapioChannelRef.current) {
        supabase.removeChannel(cardapioChannelRef.current)
          .then(status => console.log('Canal Realtime (Cárdapio) removido, status:', status))
          .catch(console.error);
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
      // Limpa o formulário
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
            setEditedItems(prev => ({ ...prev, [itemId]: {} })); // Inicia rastreamento
            return {
              ...item,
              isEditing: true,
            };
          } else {
            // Saindo do modo de edição (cancelando): restaura o estado original
            const originalItem = itensCardapio.find(i => i.id === itemId); // Pega o estado atual do DB (ou o último salvo)
            setEditedItems(prev => {
                const newState = { ...prev };
                delete newState[itemId]; // Para de rastrear
                return newState;
            });
            return {
              ...originalItem,
              isEditing: false,
            } as CardapioItem; // Garante que o tipo está correto
          }
        }
        return item;
      })
    );
  };

  // Handler para mudanças nos inputs de edição
  const handleEditInputChange = (itemId: number, field: keyof CardapioItem, value: any) => {
    // Tratamento especial para 'disponivel' que vem do select como string
    const finalValue = field === 'disponivel' ? (value === 'true') : value;
    
    setItensCardapio(prevItens =>
      prevItens.map(item =>
        item.id === itemId ? { ...item, [field]: finalValue } : item
      )
    );
    // Atualiza o estado de itens editados
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
        // Verifica se algum campo rastreado foi alterado
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
      // Monta o objeto apenas com os campos que podem ser atualizados
      const updateData: Partial<CardapioItem> = {
        nome_produto,
        categoria,
        disponivel,
        descricao_produto,
        observacao,
        promocao,
      };
      return supabase
        .from('Cárdapio')
        .update(updateData)
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

  // Agrupa itens por categoria para renderização
  const groupedItens = itensCardapio.reduce((acc, item) => {
    const categoria = item.categoria || "Sem Categoria"; // Agrupa itens sem categoria
    if (!acc[categoria]) {
      acc[categoria] = [];
    }
    acc[categoria].push(item);
    return acc;
  }, {} as Record<string, CardapioItem[]>);

  // Renderização principal da página
  return (
    // Adicionado padding-bottom maior para não cobrir o último card com o botão sticky
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
        {/* **CORREÇÃO: Estilo do botão Adicionar restaurado** */}
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-pink-500 hover:bg-pink-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md flex items-center transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:ring-opacity-70"
        >
          <PlusCircle size={20} className="mr-2" />
          Adicionar Novo Item
        </button>
      </div>

      {/* Botão Salvar Alterações - STICKY e com estilo restaurado */}
      {itemsComAlteracoes.length > 0 && (
        <div className="sticky bottom-4 w-full flex justify-center z-40 px-4">
            {/* **CORREÇÃO: Estilo do botão Salvar restaurado (semelhante ao Adicionar)** */}
            <button
                onClick={handleSaveAllChanges}
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-xl flex items-center text-lg transition-all duration-150 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-70"
            >
                {saving ? <Loader2 size={24} className="animate-spin mr-2" /> : <Save size={24} className="mr-2" />}
                {saving ? 'Salvando...' : `Salvar ${itemsComAlteracoes.length} Alterações`}
            </button>
        </div>
      )}

      {/* Modal Adicionar Item - Com footer fixo e estilo ajustado */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            {/* Cabeçalho */}
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-xl font-semibold text-gray-800">Adicionar Novo Item ao Cardápio</h3>
            </div>
            {/* Conteúdo Rolável */}
            <form onSubmit={handleAddNewItem} className="p-6 overflow-y-auto flex-grow">
              {/* Campos do formulário - Usando classes consistentes */}
              <div className="mb-4">
                <label htmlFor="add-nome_produto" className="label-style">Nome do Produto <span className="text-red-500">*</span></label>
                <input type="text" id="add-nome_produto" name="nome_produto" value={novoItem.nome_produto} onChange={handleNovoItemInputChange} className="input-field" required />
              </div>
              <div className="mb-4">
                <label htmlFor="add-categoria" className="label-style">Categoria <span className="text-red-500">*</span></label>
                <select id="add-categoria" name="categoria" value={novoItem.categoria} onChange={handleNovoItemInputChange} className="input-field" required>
                  {categoriasOrdem.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div className="mb-4">
                <label htmlFor="add-disponivel" className="label-style">Disponível?</label>
                <select id="add-disponivel" name="disponivel" value={novoItem.disponivel ? 'true' : 'false'} onChange={handleNovoItemDisponivelChange} className="input-field">
                  <option value="true">Sim</option>
                  <option value="false">Não</option>
                </select>
              </div>
              <div className="mb-4">
                <label htmlFor="add-descricao_produto" className="label-style">Descrição</label>
                <textarea id="add-descricao_produto" name="descricao_produto" value={novoItem.descricao_produto || ''} onChange={handleNovoItemInputChange} rows={3} className="input-field"></textarea>
              </div>
              <div className="mb-4">
                <label htmlFor="add-observacao" className="label-style">Observação</label>
                <textarea id="add-observacao" name="observacao" value={novoItem.observacao || ''} onChange={handleNovoItemInputChange} rows={2} className="input-field"></textarea>
              </div>
              <div className="mb-4">
                <label htmlFor="add-promocao" className="label-style">Promoção</label>
                <textarea id="add-promocao" name="promocao" value={novoItem.promocao || ''} onChange={handleNovoItemInputChange} rows={2} className="input-field"></textarea>
              </div>
            </form>
            {/* Rodapé Fixo */}
            <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3 rounded-b-xl">
              <button type="button" onClick={() => setIsAddModalOpen(false)} disabled={saving} className="btn-secondary">
                <XCircle size={18} className="inline mr-1"/> Cancelar
              </button>
              {/* **CORREÇÃO: Estilo do botão Salvar no modal** */}
              <button type="submit" form="add-item-form" disabled={saving} className="btn-primary bg-green-600 hover:bg-green-700">
                {saving ? <Loader2 size={18} className="inline mr-1 animate-spin"/> : <Save size={18} className="inline mr-1"/>}
                {saving ? 'Salvando...' : 'Adicionar Item'}
              </button>
            </div>
          </div>
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

      {/* Renderização das categorias e itens */}
      {categoriasOrdem.map(categoria => (
        // Renderiza a seção apenas se houver itens ou se for a categoria "Sem Categoria" com itens
        (groupedItens[categoria] && groupedItens[categoria].length > 0) || (categoria === "Sem Categoria" && groupedItens[categoria]?.length > 0) ? (
          <div key={categoria} className="mb-8">
            <h3 className="text-2xl font-semibold text-gray-800 mb-4 pb-2 border-b-2 border-pink-200">{categoria}</h3>
            {/* **CORREÇÃO: Grid responsivo para os cards** */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {groupedItens[categoria].map(item => (
                // **CORREÇÃO: Estilo do Card restaurado (tema rosa, sombra, espaçamento)**
                <div key={item.id} className={`bg-white rounded-xl shadow-md hover:shadow-lg transition-shadow duration-300 border border-gray-200 flex flex-col ${item.isEditing ? 'ring-2 ring-pink-400 ring-offset-2' : ''}`}>
                  {/* Conteúdo Principal (Não Editável) */}
                  {!item.isEditing ? (
                    <div className="p-5 flex flex-col flex-grow">
                      <div className="flex justify-between items-start mb-2">
                        {/* **CORREÇÃO: Nome do produto visível, sem corte** */}
                        <h4 className="text-lg font-semibold text-gray-900 break-words flex-grow mr-2">{item.nome_produto}</h4>
                        {/* **CORREÇÃO: Estilo do botão Disponível/Indisponível** */}
                        <span className={`px-3 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${item.disponivel ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {item.disponivel ? 'Disponível' : 'Indisponível'}
                        </span>
                      </div>
                      {/* **CORREÇÃO: Descrição visível, sem corte, e só aparece se existir** */}
                      {item.descricao_produto && (
                        <p className="text-sm text-gray-600 mt-1 mb-3 break-words whitespace-pre-wrap"><strong>Descrição:</strong> {item.descricao_produto}</p>
                      )}
                      {/* **CORREÇÃO: Observação visível, sem corte, e só aparece se existir** */}
                      {item.observacao && (
                        <p className="text-sm text-gray-500 mt-1 mb-3 break-words whitespace-pre-wrap"><strong>Observação:</strong> {item.observacao}</p>
                      )}
                      {/* **CORREÇÃO: Promoção visível, sem corte, e só aparece se existir** */}
                      {item.promocao && (
                        <div className="bg-pink-50 border border-pink-200 rounded-md p-2 mt-1 mb-3">
                          <p className="text-sm text-pink-700 break-words whitespace-pre-wrap"><strong>Promoção:</strong> {item.promocao}</p>
                        </div>
                      )}
                      {/* **CORREÇÃO: Remove espaço extra se não houver descrição/obs/promoção** */}
                      {!item.descricao_produto && !item.observacao && !item.promocao && <div className="flex-grow"></div>} 
                      {/* Rodapé com botões de ação */}
                      <div className="mt-auto pt-3 border-t border-gray-100 flex justify-end space-x-2">
                        {/* **CORREÇÃO: Estilo dos botões Editar/Excluir restaurado** */}
                        <button onClick={() => toggleEditMode(item.id)} className="btn-icon text-blue-600 hover:text-blue-800">
                          <Edit3 size={18} />
                        </button>
                        <button onClick={() => openDeleteConfirmationModal(item)} className="btn-icon text-red-600 hover:text-red-800">
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Conteúdo Editável */
                    <div className="p-5 flex flex-col flex-grow">
                      <div className="mb-3">
                        <label htmlFor={`nome-${item.id}`} className="label-style">Nome</label>
                        <input type="text" id={`nome-${item.id}`} value={item.nome_produto} onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)} className="input-field" />
                      </div>
                      <div className="mb-3">
                        <label htmlFor={`categoria-${item.id}`} className="label-style">Categoria</label>
                        <select id={`categoria-${item.id}`} value={item.categoria} onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)} className="input-field">
                          {categoriasOrdem.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                          {/* Adiciona opção para categoria atual se não estiver na lista padrão */}
                          {!categoriasOrdem.includes(item.categoria) && <option value={item.categoria}>{item.categoria}</option>}
                        </select>
                      </div>
                      <div className="mb-3">
                        <label htmlFor={`disponivel-${item.id}`} className="label-style">Disponível</label>
                        <select id={`disponivel-${item.id}`} value={item.disponivel ? 'true' : 'false'} onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value)} className="input-field">
                          <option value="true">Sim</option>
                          <option value="false">Não</option>
                        </select>
                      </div>
                      <div className="mb-3">
                        <label htmlFor={`descricao-${item.id}`} className="label-style">Descrição</label>
                        <textarea id={`descricao-${item.id}`} value={item.descricao_produto || ''} onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)} rows={3} className="input-field"></textarea>
                      </div>
                      <div className="mb-3">
                        <label htmlFor={`observacao-${item.id}`} className="label-style">Observação</label>
                        <textarea id={`observacao-${item.id}`} value={item.observacao || ''} onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)} rows={2} className="input-field"></textarea>
                      </div>
                      <div className="mb-3">
                        <label htmlFor={`promocao-${item.id}`} className="label-style">Promoção</label>
                        <textarea id={`promocao-${item.id}`} value={item.promocao || ''} onChange={(e) => handleEditInputChange(item.id, 'promocao', e.target.value)} rows={2} className="input-field"></textarea>
                      </div>
                      {/* Rodapé com botões de ação (Cancelar/Salvar Individual - Opcional) */}
                      <div className="mt-auto pt-3 border-t border-gray-100 flex justify-end space-x-2">
                        {/* **CORREÇÃO: Estilo dos botões Cancelar/Salvar (individual, se necessário)** */}
                        <button onClick={() => toggleEditMode(item.id)} className="btn-secondary">
                          <XCircle size={18} className="inline mr-1"/> Cancelar
                        </button>
                        {/* O botão Salvar principal (sticky) salva tudo */}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null // Não renderiza a seção se não houver itens nessa categoria
      ))}
    </div>
  );
};

export default CardapioPage;

// **Estilos reutilizáveis (adicionar ao App.css ou similar)**
/*
.label-style {
  @apply block text-sm font-medium text-gray-700 mb-1;
}
.input-field {
  @apply w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm transition-all duration-150;
}
.btn-primary {
  @apply px-4 py-2 bg-pink-600 hover:bg-pink-700 text-white rounded-lg shadow-md text-sm font-medium transition-all duration-150 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-pink-400 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed;
}
.btn-secondary {
  @apply px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg shadow-sm text-sm font-medium transition-all duration-150 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed;
}
.btn-danger {
  @apply px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg shadow-md text-sm font-medium transition-all duration-150 flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed;
}
.btn-icon {
  @apply p-1 rounded-md hover:bg-gray-100 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-gray-300;
}
*/


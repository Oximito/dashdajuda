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
  promocao?: string | null; // Adicionado campo promoção
  isEditing?: boolean;
  // Campos para guardar o estado original durante a edição
  originalNome?: string;
  originalCategoria?: string;
  originalDisponivel?: boolean;
  originalDescricao?: string | null;
  originalObservacao?: string | null;
  originalPromocao?: string | null; // Adicionado campo promoção original
}

// Ordem definida das categorias
const categoriasOrdem = [
  "Marmita do dia",
  "Marmita clássica",
  "Mix de salada", // Adicionado Mix de salada conforme solicitado
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
  const [editedItems, setEditedItems] = useState<Record<number, Partial<CardapioItem>>>({}); // Rastreia edições

  // Estado inicial para o formulário de novo item
  const [novoItem, setNovoItem] = useState<Partial<Omit<CardapioItem, 'id'>>>({ 
    nome_produto: '',
    categoria: categoriasOrdem[0], // Usa a ordem definida
    disponivel: true,
    descricao_produto: '',
    observacao: '',
    promocao: '', // Adicionado campo promoção
  });

  // Busca itens do cardápio, com tratamento de erro e ordenação
  const fetchItensCardapio = useCallback(async (source?: string) => {
    console.log(`Buscando itens do cardápio... (Origem: ${source || 'desconhecida'})`);
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('Cárdapio') // Nome correto da tabela
      .select('*');
      // A ordenação será feita no frontend para garantir a ordem personalizada

    if (fetchError) {
      console.error('Erro ao buscar itens do cardápio:', fetchError);
      setError(`Falha ao carregar cardápio: ${fetchError.message}`);
      setItensCardapio([]); // Limpa em caso de erro
    } else {
      // Ordena os dados recebidos pela ordem definida em categoriasOrdem
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
        promocao: novoItem.promocao || null, // Adicionado campo promoção
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
      // O Realtime deve atualizar a lista, mas podemos forçar se necessário
      // fetchItensCardapio('after add');
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
      // fetchItensCardapio('after delete');
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
    setItensCardapio(prevItens =>
      prevItens.map(item =>
        item.id === itemId ? { ...item, [field]: value } : item
      )
    );
    // Atualiza o estado de itens editados
    setEditedItems(prev => ({
        ...prev,
        [itemId]: { ...prev[itemId], [field]: value }
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
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="bg-green-500 hover:bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow-md flex items-center transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-70"
        >
          <PlusCircle size={20} className="mr-2" />
          Adicionar Novo Item
        </button>
      </div>

      {/* Botão Salvar Alterações - AGORA STICKY */}
      {itemsComAlteracoes.length > 0 && (
        // Usa 'sticky' e 'bottom-4' para fixar perto do final da viewport ao rolar
        // 'z-40' para garantir que fique acima dos cards
        <div className="sticky bottom-4 w-full flex justify-center z-40 px-4">
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

      {/* Modal Adicionar Item - Com footer fixo */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
          {/* Estrutura flex column para footer fixo */}
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            {/* Cabeçalho Fixo */}
            <div className="p-6 border-b border-gray-200">
                <h3 className="text-2xl font-semibold text-gray-800">Adicionar Novo Item</h3>
            </div>
            {/* Conteúdo Rolável */}
            <form onSubmit={handleAddNewItem} className="overflow-y-auto flex-grow p-6">
              {/* Campos do formulário... */}
              <div className="mb-4">
                <label htmlFor="nome_produto_novo" className="block text-sm font-medium text-gray-700 mb-1">Nome do Produto</label>
                <input type="text" name="nome_produto" id="nome_produto_novo" value={novoItem.nome_produto || ''} onChange={handleNovoItemInputChange} required className="input-field" />
              </div>
              <div className="mb-4">
                <label htmlFor="categoria_novo" className="block text-sm font-medium text-gray-700 mb-1">Categoria</label>
                <select name="categoria" id="categoria_novo" value={novoItem.categoria} onChange={handleNovoItemInputChange} required className="input-field">
                  {categoriasOrdem.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
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
              <div className="mb-4">
                <label htmlFor="observacao_novo" className="block text-sm font-medium text-gray-700 mb-1">Observação</label>
                <textarea name="observacao" id="observacao_novo" value={novoItem.observacao || ''} onChange={handleNovoItemInputChange} rows={2} className="input-field" />
              </div>
              <div className="mb-4">
                <label htmlFor="promocao_novo" className="block text-sm font-medium text-gray-700 mb-1">Promoção</label>
                <textarea name="promocao" id="promocao_novo" value={novoItem.promocao || ''} onChange={handleNovoItemInputChange} rows={2} className="input-field" />
              </div>
            </form>
            {/* Rodapé Fixo */}
            <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3 rounded-b-xl">
              <button type="button" onClick={() => setIsAddModalOpen(false)} disabled={saving} className="btn-secondary">
                <XCircle size={18} className="inline mr-1"/> Cancelar
              </button>
              <button type="submit" form="add-item-form" disabled={saving} className="btn-primary bg-green-500 hover:bg-green-600">
                {saving ? <Loader2 size={18} className="inline mr-1 animate-spin"/> : <Save size={18} className="inline mr-1"/>}
                {saving ? 'Salvando...' : 'Salvar Novo Item'}
              </button>
            </div>
            {/* Adiciona um ID ao form para o botão submit externo funcionar */}
            <form id="add-item-form" onSubmit={handleAddNewItem} className="hidden"></form>
          </div>
        </div>
      )}

      {/* Modal Confirmar Remoção */}
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

      {/* Mensagem de cardápio vazio */}
      {itensCardapio.length === 0 && !loading && !error && (
        <div className="text-center text-gray-500 mt-12">
          <p className="text-2xl mb-2">Nenhum item no cardápio ainda.</p>
          <p className="text-lg">Clique em "Adicionar Novo Item" para começar.</p>
        </div>
      )}
      
      {/* Renderização das categorias e itens */}
      {categoriasOrdem.map(categoria => (
        groupedItens[categoria] && groupedItens[categoria].length > 0 && (
          <div key={categoria} className="mb-10">
            <h3 className="text-2xl font-semibold text-gray-800 mb-5 border-b pb-2 border-gray-200">{categoria}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {groupedItens[categoria].map(item => (
                <div key={item.id} className={`bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden transition-all duration-200 ${item.isEditing ? 'ring-2 ring-blue-400 shadow-lg' : 'hover:shadow-lg'}`}>
                  <div className="p-5">
                    {/* Nome do Produto - Centralizado e sem truncar */}
                    <h4 className={`text-lg font-semibold mb-2 text-center ${item.isEditing ? 'text-blue-700' : 'text-gray-800'} whitespace-normal break-words`}>
                      {item.isEditing ? (
                        <input 
                          type="text" 
                          value={item.nome_produto}
                          onChange={(e) => handleEditInputChange(item.id, 'nome_produto', e.target.value)}
                          className="input-edit text-center"
                        />
                      ) : (
                        item.nome_produto
                      )}
                    </h4>
                    {/* Disponibilidade */}
                    <div className="text-center mb-3">
                      {item.isEditing ? (
                        <select 
                          value={item.disponivel ? 'true' : 'false'}
                          onChange={(e) => handleEditInputChange(item.id, 'disponivel', e.target.value === 'true')}
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${item.disponivel ? 'bg-green-100 text-green-800 border-green-200' : 'bg-red-100 text-red-800 border-red-200'}`}
                        >
                          <option value="true">Disponível</option>
                          <option value="false">Indisponível</option>
                        </select>
                      ) : (
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${item.disponivel ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {item.disponivel ? 'Disponível' : 'Indisponível'}
                        </span>
                      )}
                    </div>
                    
                    {/* Descrição - Justificada e sem truncar */}
                    {(item.descricao_produto || item.isEditing) && (
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Descrição:</label>
                        {item.isEditing ? (
                          <textarea 
                            value={item.descricao_produto || ''}
                            onChange={(e) => handleEditInputChange(item.id, 'descricao_produto', e.target.value)}
                            rows={3}
                            className="input-edit text-sm"
                          />
                        ) : (
                          <p className="text-sm text-gray-600 text-justify whitespace-normal break-words">
                            {item.descricao_produto}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Observação - Justificada e sem truncar */}
                    {(item.observacao || item.isEditing) && (
                      <div className="mb-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Observação:</label>
                        {item.isEditing ? (
                          <textarea 
                            value={item.observacao || ''}
                            onChange={(e) => handleEditInputChange(item.id, 'observacao', e.target.value)}
                            rows={2}
                            className="input-edit text-sm"
                          />
                        ) : (
                          <p className="text-sm text-gray-600 text-justify whitespace-normal break-words">
                            {item.observacao}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Promoção - Justificada e sem truncar */}
                    {(item.promocao || item.isEditing) && (
                      <div className="mb-3 bg-pink-50 p-2 rounded-md border border-pink-100">
                        <label className="block text-xs font-medium text-pink-700 mb-1">Promoção:</label>
                        {item.isEditing ? (
                          <textarea 
                            value={item.promocao || ''}
                            onChange={(e) => handleEditInputChange(item.id, 'promocao', e.target.value)}
                            rows={2}
                            className="input-edit text-sm bg-white"
                          />
                        ) : (
                          <p className="text-sm text-pink-800 text-justify whitespace-normal break-words">
                            {item.promocao}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Categoria (apenas editável) */}
                    {item.isEditing && (
                       <div className="mb-3">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Categoria:</label>
                        <select 
                          value={item.categoria}
                          onChange={(e) => handleEditInputChange(item.id, 'categoria', e.target.value)}
                          className="input-edit text-sm"
                        >
                          {categoriasOrdem.map(cat => (<option key={cat} value={cat}>{cat}</option>))}
                        </select>
                      </div>
                    )}
                  </div>
                  {/* Botões de Ação */}
                  <div className="bg-gray-50 px-4 py-3 flex justify-end space-x-2 border-t border-gray-200">
                    <button 
                      onClick={() => toggleEditMode(item.id)}
                      className={`btn-icon ${item.isEditing ? 'btn-secondary' : 'btn-primary-outline'}`}
                      title={item.isEditing ? "Cancelar Edição" : "Editar Item"}
                    >
                      {item.isEditing ? <XCircle size={18} /> : <Edit3 size={18} />}
                    </button>
                    <button 
                      onClick={() => openDeleteConfirmationModal(item)}
                      className="btn-icon btn-danger-outline"
                      title="Remover Item"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      ))}
    </div>
  );
};

export default CardapioPage;


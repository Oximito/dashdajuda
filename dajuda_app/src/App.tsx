import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import { supabase } from "./supabaseClient";
import ComandaCard, { Pedido } from "./components/ComandaCard";
import CardapioPage from "./components/CardapioPage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AlertTriangle, Loader2, X, Save, Trash2 } from "lucide-react";

const notificationSound = "/assets/sounds/notify.mp3";

type View = "comandas" | "cardapio";

function App() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newPedidoKeys, setNewPedidoKeys] = useState<Set<string>>(new Set());
  const audioPlayer = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [currentView, setCurrentView] = useState<View>("comandas");
  const [reconnecting, setReconnecting] = useState<boolean>(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 5000; // Base delay 5 segundos
  
  // Modal de edição/exclusão de comanda
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [currentPedido, setCurrentPedido] = useState<Pedido | null>(null);
  const [editedPedido, setEditedPedido] = useState<Partial<Pedido>>({});
  const [saving, setSaving] = useState<boolean>(false);

  const statusOptions: string[] = ["Aguardando", "Em preparo", "Pronto", "Enviado", "Entregue"];
  const pagamentoOptions: string[] = ["Aguardando pagamento", "Pago"];

  const playNotificationSound = () => {
    if (audioPlayer.current) {
      audioPlayer.current.play().catch(e => console.error("Erro ao tocar som de notificação:", e));
    }
  };

  // Busca inicial e manual de pedidos
  const fetchPedidos = useCallback(async (source?: string) => {
    console.log(`Buscando pedidos... (Origem: ${source || 'desconhecida'})`);
    const { data, error: fetchError } = await supabase
      .from("Comandas")
      .select("*, hora_criacao_pedido")
      .order("hora_criacao_pedido", { ascending: false });

    if (fetchError) {
      console.error("Erro ao buscar pedidos:", fetchError);
      setError(`Falha ao carregar pedidos: ${fetchError.message}`);
      setPedidos([]);
    } else {
      const fetchedPedidos = data as Pedido[];
      console.log("Pedidos buscados:", fetchedPedidos);
      setPedidos(fetchedPedidos);
      // Limpa o erro apenas se a busca for bem-sucedida
      // Não limpa erros de realtime aqui
      // setError(null); 
    }
  }, []);

  // Função para configurar o canal Realtime das Comandas
  const setupRealtimeChannel = useCallback(() => {
    console.log("Configurando canal Realtime para Comandas...");
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
        .then(() => console.log('Canal Realtime (Comandas) removido antes de reconectar'))
        .catch(console.error);
      channelRef.current = null;
    }

    const handleChanges = (payload: any) => {
      console.log("Mudança recebida do Supabase Realtime (Comandas)!", payload);
      if (payload.eventType === "INSERT" && payload.new.telefone_key) {
        const newKey = payload.new.telefone_key as string;
        // Toca som e destaca apenas se o pedido for realmente novo no estado atual
        setPedidos(prevPedidos => {
            if (!prevPedidos.find(p => p.telefone_key === newKey)) {
                playNotificationSound();
                setNewPedidoKeys(prev => new Set(prev).add(newKey));
                setTimeout(() => {
                  setNewPedidoKeys(prev => {
                    const updated = new Set(prev);
                    updated.delete(newKey);
                    return updated;
                  });
                }, 5000); // Remove destaque após 5 segundos
                // Adiciona o novo pedido ao estado
                return [...prevPedidos, payload.new].sort((a, b) => new Date(b.hora_criacao_pedido).getTime() - new Date(a.hora_criacao_pedido).getTime());
            } else {
                // Se já existe, apenas atualiza (caso raro, mas seguro)
                return prevPedidos.map(p => p.telefone_key === newKey ? payload.new : p).sort((a, b) => new Date(b.hora_criacao_pedido).getTime() - new Date(a.hora_criacao_pedido).getTime());
            }
        });
      } else if (payload.eventType === "UPDATE") {
          const updatedKey = payload.new.telefone_key as string;
          setPedidos(prevPedidos => prevPedidos.map(p => p.telefone_key === updatedKey ? payload.new : p).sort((a, b) => new Date(b.hora_criacao_pedido).getTime() - new Date(a.hora_criacao_pedido).getTime()));
      } else if (payload.eventType === "DELETE") {
          const deletedKey = payload.old.telefone_key as string;
          setPedidos(prevPedidos => prevPedidos.filter(p => p.telefone_key !== deletedKey));
      }
    };

    channelRef.current = supabase
      .channel("comandas_realtime_channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "Comandas" },
        handleChanges
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log("Conectado ao canal Realtime do Supabase (Comandas)!");
          setError(null); // Limpa erro ao conectar com sucesso
          setReconnecting(false);
          reconnectAttemptsRef.current = 0;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Trata erros e timeouts que exigem reconexão
          const errorMsg = status === "CHANNEL_ERROR" ? (err?.message || "Erro desconhecido") : status;
          console.error(`Erro/Status no canal Realtime (Comandas): ${errorMsg}`);
          handleReconnect(errorMsg);
        } else if (status === "CLOSED") {
          // Canal fechado - pode ser normal (ex: troca de view) ou inesperado.
          // Não inicia reconexão agressiva aqui, apenas loga.
          console.log("Canal Realtime (Comandas) fechado. Status:", status);
          // Se a view ainda for 'comandas', pode indicar um problema, mas não força retry loop.
          if (currentView === 'comandas' && !reconnecting) {
             // setError("Conexão em tempo real (Comandas) fechada inesperadamente.");
             // Poderia tentar uma única reconexão suave aqui se necessário.
          }
        }
      });
  }, [currentView]); // Depende de currentView para lógica de fechamento

  // Função para gerenciar reconexões com backoff exponencial
  const handleReconnect = useCallback((errorMessage: string) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttemptsRef.current += 1;
      setReconnecting(true);
      setError(null); // Limpa erro enquanto tenta reconectar
      
      const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current - 1);
      console.log(`Tentativa de reconexão (Comandas) ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS} em ${delay / 1000}s...`);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        if (currentView === 'comandas') { // Só tenta reconectar se ainda estiver na view de comandas
            setupRealtimeChannel();
        }
      }, delay);
    } else {
      setReconnecting(false);
      setError(`Erro de conexão em tempo real (Comandas): ${errorMessage} - Falha após ${MAX_RECONNECT_ATTEMPTS} tentativas. Verifique a conexão ou atualize a página.`);
    }
  }, [setupRealtimeChannel, currentView]);

  // Efeito para gerenciar a conexão/desconexão do canal ao mudar de view
  useEffect(() => {
    if (currentView === "comandas") {
        console.log("Entrando na view Comandas, buscando pedidos e configurando Realtime...");
        fetchPedidos('view change');
        setupRealtimeChannel();

        // Configura áudio
        audioPlayer.current = new Audio(notificationSound);
        audioPlayer.current.load();

        return () => {
          console.log("Saindo da view Comandas, limpando timeouts e removendo canal Realtime...");
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
              .then(status => console.log("Canal Realtime (Comandas) removido ao sair da view, status:", status))
              .catch(console.error);
            channelRef.current = null;
          }
          reconnectAttemptsRef.current = 0; // Reseta tentativas ao sair da view
          setReconnecting(false);
          // Não limpa o erro aqui, pode ser útil manter se houve falha
        };
    } else {
        // Se não está na view de comandas, garante que o canal está fechado
        console.log("Mudando para view Cardápio, garantindo que canal de Comandas está fechado.");
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
              .then(status => console.log("Canal Realtime (Comandas) removido ao mudar para Cardápio, status:", status))
              .catch(console.error);
            channelRef.current = null;
        }
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        setReconnecting(false);
        // Limpa erros específicos de comandas ao mudar de view
        if (error?.includes("(Comandas)")) {
            setError(null); 
        }
    }
  }, [currentView, fetchPedidos, setupRealtimeChannel]);

  // Handler para atualização manual ou via card
  const handlePedidoUpdate = () => {
    console.log("Atualização de pedido individual concluída, re-buscando todos os pedidos.");
    fetchPedidos('manual update or card action');
  };

  // Funções para o modal de edição
  const openEditModal = (pedido: Pedido) => {
    setCurrentPedido(pedido);
    setEditedPedido({
      nome_cliente: pedido.nome_cliente,
      comanda: pedido.comanda,
      status_pedido: pedido.status_pedido,
      pagamento: pedido.pagamento
    });
    setIsEditModalOpen(true);
  };

  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditedPedido(prev => ({ ...prev, [name]: value }));
  };

  const handleSaveEdit = async () => {
    if (!currentPedido) return;
    
    setSaving(true);
    const { error: updateError } = await supabase
      .from("Comandas")
      .update({
        nome_cliente: editedPedido.nome_cliente,
        comanda: editedPedido.comanda,
        status_pedido: editedPedido.status_pedido,
        pagamento: editedPedido.pagamento
      })
      .eq("telefone_key", currentPedido.telefone_key);
    
    setSaving(false);
    
    if (updateError) {
      console.error("Erro ao atualizar comanda:", updateError);
      alert(`Falha ao atualizar comanda: ${updateError.message}`);
    } else {
      alert("Comanda atualizada com sucesso!");
      setIsEditModalOpen(false);
      // O Realtime deve atualizar a lista, mas podemos forçar se necessário
      // fetchPedidos('after edit save'); 
    }
  };

  // Funções para o modal de exclusão
  const openDeleteModal = (pedido: Pedido) => {
    setCurrentPedido(pedido);
    setIsDeleteModalOpen(true);
  };

  const handleDeletePedido = async () => {
    if (!currentPedido) return;
    
    setSaving(true);
    const { error: deleteError } = await supabase
      .from("Comandas")
      .delete()
      .eq("telefone_key", currentPedido.telefone_key);
    
    setSaving(false);
    
    if (deleteError) {
      console.error("Erro ao excluir comanda:", deleteError);
      alert(`Falha ao excluir comanda: ${deleteError.message}`);
    } else {
      alert("Comanda excluída com sucesso!");
      setIsDeleteModalOpen(false);
      // O Realtime deve atualizar a lista, mas podemos forçar se necessário
      // fetchPedidos('after delete'); 
    }
  };

  // Renderização principal
  return (
    <div className="p-4 sm:p-6 bg-gray-50 min-h-screen font-sans">
      <header className="mb-8">
        <h1 className="text-4xl sm:text-5xl font-bold text-center text-pink-600">D'Ajuda Refeições</h1>
        {/* Navegação entre Abas */}
        <nav className="mt-4 mb-6 flex justify-center space-x-4 sm:space-x-6">
          <button 
            onClick={() => setCurrentView("comandas")} 
            className={`px-4 py-2 sm:px-6 sm:py-2 rounded-lg text-base sm:text-lg font-medium transition-all duration-150 
                        ${currentView === "comandas" 
                          ? "bg-pink-600 text-white shadow-md scale-105" 
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
          >
            Pedidos
          </button>
          <button 
            onClick={() => setCurrentView("cardapio")} 
            className={`px-4 py-2 sm:px-6 sm:py-2 rounded-lg text-base sm:text-lg font-medium transition-all duration-150 
                        ${currentView === "cardapio" 
                          ? "bg-pink-600 text-white shadow-md scale-105" 
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
          >
            Cardápio
          </button>
        </nav>
        {/* Título da Aba Atual */}
        {currentView === "comandas" && <p className="text-xl sm:text-2xl text-center text-gray-600">Painel de Pedidos</p>}
        {currentView === "cardapio" && <p className="text-xl sm:text-2xl text-center text-gray-600">Gerenciamento do Cardápio</p>}
      </header>

      {/* Mensagem de Erro (Não bloqueante) */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg shadow-sm flex items-center justify-center">
          <AlertTriangle size={20} className="mr-2 flex-shrink-0" /> 
          <span className="flex-grow text-center text-sm sm:text-base">{error}</span>
          {reconnecting && <Loader2 size={20} className="animate-spin ml-2 flex-shrink-0" />}
        </div>
      )}
      
      {/* Conteúdo da Aba Comandas */}
      {currentView === "comandas" && (
        <>
          {/* Botão Atualizar Manual */}
          <div className="text-center mb-6">
            <button 
              onClick={() => fetchPedidos('manual button')} 
              className="px-5 py-2 bg-pink-500 text-white rounded-lg shadow hover:bg-pink-600 transition-colors focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-opacity-50 text-base font-medium"
            >
              Atualizar Pedidos
            </button>
          </div>

          {/* Estado de Nenhum Pedido */}
          {pedidos.length === 0 && !error && (
            <div className="text-center text-gray-500 mt-10">
              <p className="text-2xl mb-2">Nenhum pedido no momento.</p>
              <p className="text-lg">Aguardando novas comandas...</p>
            </div>
          )}

          {/* Grid de Comandas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {pedidos.map((pedido) => (
              <ComandaCard 
                key={pedido.telefone_key} 
                pedido={pedido} 
                onUpdate={handlePedidoUpdate} // Passa a função de busca para o card (caso necessário) 
                isNew={newPedidoKeys.has(pedido.telefone_key)}
                onEdit={() => openEditModal(pedido)}
                onDelete={() => openDeleteModal(pedido)}
              />
            ))}
          </div>

          {/* Modal de Edição */}
          {isEditModalOpen && currentPedido && (
            <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
              <div className="bg-white p-6 sm:p-8 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl sm:text-2xl font-semibold text-gray-800">Editar Comanda</h3>
                  <button 
                    onClick={() => setIsEditModalOpen(false)}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>
                
                {/* Formulário de Edição */}
                <div className="flex-grow overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 space-y-4">
                  <div>
                    <label htmlFor="nome_cliente" className="block text-sm font-medium text-gray-700 mb-1">Nome do Cliente</label>
                    <input 
                      type="text" 
                      id="nome_cliente" 
                      name="nome_cliente" 
                      value={editedPedido.nome_cliente || ''} 
                      onChange={handleEditInputChange}
                      className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                    />
                  </div>
                  
                  <div>
                    <label htmlFor="comanda" className="block text-sm font-medium text-gray-700 mb-1">Texto da Comanda</label>
                    <textarea 
                      id="comanda" 
                      name="comanda" 
                      value={editedPedido.comanda || ''} 
                      onChange={handleEditInputChange}
                      rows={5}
                      className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                    />
                  </div>
                  
                  <div>
                    <label htmlFor="status_pedido" className="block text-sm font-medium text-gray-700 mb-1">Status do Pedido</label>
                    <select 
                      id="status_pedido" 
                      name="status_pedido" 
                      value={editedPedido.status_pedido || ''} 
                      onChange={handleEditInputChange}
                      className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-colors appearance-none bg-white bg-no-repeat bg-right pr-8"
                      style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\\\' fill=\'none\\\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\\' stroke-linecap=\'round\\' stroke-linejoin=\'round\\' stroke-width=\'1.5\\' d=\'M6 8l4 4 4-4\'/\%3e%3c/svg%3e")`}}
                    >
                      {statusOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label htmlFor="pagamento" className="block text-sm font-medium text-gray-700 mb-1">Status do Pagamento</label>
                    <select 
                      id="pagamento" 
                      name="pagamento" 
                      value={editedPedido.pagamento || ''} 
                      onChange={handleEditInputChange}
                      className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-1 focus:ring-pink-500 focus:border-pink-500 transition-colors appearance-none bg-white bg-no-repeat bg-right pr-8"
                      style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\\\' fill=\'none\\\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\\' stroke-linecap=\'round\\' stroke-linejoin=\'round\\' stroke-width=\'1.5\\' d=\'M6 8l4 4 4-4\'/\%3e%3c/svg%3e")`}}
                    >
                      {pagamentoOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {/* Botões do Modal */}
                <div className="mt-6 pt-4 border-t border-gray-200 flex justify-end space-x-3 flex-shrink-0">
                  <button 
                    type="button"
                    onClick={() => setIsEditModalOpen(false)} 
                    disabled={saving}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors flex items-center"
                  >
                     <XCircle size={18} className="mr-1"/> Cancelar
                  </button>
                  <button 
                    type="button"
                    onClick={handleSaveEdit} 
                    disabled={saving}
                    className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded-lg shadow transition-colors flex items-center"
                  >
                    {saving ? <Loader2 size={18} className="mr-1 animate-spin"/> : <Save size={18} className="mr-1"/>}
                    {saving ? 'Salvando...' : 'Salvar Alterações'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal de Exclusão (Estilo Aprovado) */}
          {isDeleteModalOpen && currentPedido && (
            <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
              <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">
                <div className="text-center">
                    <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold mb-3 text-gray-800">Confirmar Remoção</h3>
                    <p className="text-gray-600 mb-6">
                      Você tem certeza que deseja remover a comanda de "<strong>{currentPedido.nome_cliente || currentPedido.telefone_key}</strong>"?
                      <br/>Esta ação não poderá ser desfeita.
                    </p>
                </div>
                <div className="flex justify-center space-x-4">
                  <button onClick={() => setIsDeleteModalOpen(false)} disabled={saving} className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors">
                    Cancelar
                  </button>
                  <button onClick={handleDeletePedido} disabled={saving} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg shadow transition-colors flex items-center">
                    {saving ? <Loader2 size={18} className="mr-1 animate-spin"/> : <Trash2 size={18} className="mr-1"/>}
                    {saving ? 'Removendo...' : 'Confirmar Remoção'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Conteúdo da Aba Cardápio */}
      {currentView === "cardapio" && (
        <CardapioPage />
      )}
    </div>
  );
}

export default App;


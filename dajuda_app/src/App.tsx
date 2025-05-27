import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import { supabase } from "./supabaseClient";
import ComandaCard, { Pedido } from "./components/ComandaCard";
import CardapioPage from "./components/CardapioPage";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { AlertTriangle, Loader2, X, Save, Edit3, Trash2 } from "lucide-react";

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
  const RECONNECT_DELAY = 3000; // 3 segundos
  
  // Modal de edição de comanda
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

  const fetchPedidos = async (isNewInsert: boolean = false, insertedKey?: string) => {
    console.log("Buscando pedidos...");
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
      setError(null);

      if (isNewInsert && insertedKey) {
        console.log("Novo pedido inserido, tocando som e destacando:", insertedKey);
        if (!pedidos.find(p => p.telefone_key === insertedKey)) {
            playNotificationSound();
            setNewPedidoKeys(prev => new Set(prev).add(insertedKey));
            setTimeout(() => {
              setNewPedidoKeys(prev => {
                const updated = new Set(prev);
                updated.delete(insertedKey);
                return updated;
              });
            }, 5000);
        }
      }
    }
  };

  // Função para configurar o canal Realtime
  const setupRealtimeChannel = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
        .then(() => console.log('Canal Realtime (Comandas) removido antes de reconectar'))
        .catch(console.error);
      channelRef.current = null;
    }

    const handleChanges = (payload: any) => {
      console.log("Mudança recebida do Supabase Realtime (Comandas)!", payload);
      if (payload.eventType === "INSERT" && payload.new.telefone_key) {
        if (!pedidos.find(p => p.telefone_key === payload.new.telefone_key)){
            fetchPedidos(true, payload.new.telefone_key as string);
        } else {
            fetchPedidos(); 
        }
      } else {
        fetchPedidos();
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
          setError(null);
          setReconnecting(false);
          reconnectAttemptsRef.current = 0;
        } else if (status === "CHANNEL_ERROR") {
          console.error("Erro no canal Realtime do Supabase (Comandas):", err);
          handleReconnect(err?.message || "Erro desconhecido");
        } else if (status === "TIMED_OUT") {
          console.warn("Timeout na conexão Realtime do Supabase (Comandas).");
          handleReconnect("Timeout");
        } else if (status === "CLOSED"){
          console.log("Canal Realtime (Comandas) fechado.");
          handleReconnect("CLOSED");
        }
      });
  }, [pedidos]);

  // Função para gerenciar reconexões
  const handleReconnect = useCallback((errorMessage: string) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttemptsRef.current += 1;
      setReconnecting(true);
      setError(`Erro de conexão em tempo real (Comandas): ${errorMessage} - Tentando reconectar...`);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log(`Tentativa de reconexão ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}...`);
        setupRealtimeChannel();
      }, RECONNECT_DELAY);
    } else {
      setReconnecting(false);
      setError(`Erro de conexão em tempo real (Comandas): ${errorMessage} - Falha após ${MAX_RECONNECT_ATTEMPTS} tentativas. Atualize a página.`);
    }
  }, [setupRealtimeChannel]);

  useEffect(() => {
    if (currentView === "comandas") {
        fetchPedidos();
        setupRealtimeChannel();

        audioPlayer.current = new Audio(notificationSound);
        audioPlayer.current.load();

        return () => {
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
          }
          
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
              .then(status => console.log("Canal Realtime (Comandas) removido, status:", status))
              .catch(console.error);
            channelRef.current = null;
          }
        };
    } else {
        // Lógica para quando a view for 'cardapio', se necessário desativar o canal de comandas
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
              .then(status => console.log("Canal Realtime (Comandas) removido ao mudar de view, status:", status))
              .catch(console.error);
            channelRef.current = null;
        }
        setError(null); // Limpar erros de comandas ao mudar de view
    }
  }, [currentView, setupRealtimeChannel]);

  const handlePedidoUpdate = () => {
    console.log("Atualização de pedido individual concluída, re-buscando todos os pedidos para manter a ordem.");
    fetchPedidos();
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
    const { error } = await supabase
      .from("Comandas")
      .update({
        nome_cliente: editedPedido.nome_cliente,
        comanda: editedPedido.comanda,
        status_pedido: editedPedido.status_pedido,
        pagamento: editedPedido.pagamento
      })
      .eq("telefone_key", currentPedido.telefone_key);
    
    setSaving(false);
    
    if (error) {
      console.error("Erro ao atualizar comanda:", error);
      alert(`Falha ao atualizar comanda: ${error.message}`);
    } else {
      alert("Comanda atualizada com sucesso!");
      setIsEditModalOpen(false);
      fetchPedidos();
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
    const { error } = await supabase
      .from("Comandas")
      .delete()
      .eq("telefone_key", currentPedido.telefone_key);
    
    setSaving(false);
    
    if (error) {
      console.error("Erro ao excluir comanda:", error);
      alert(`Falha ao excluir comanda: ${error.message}`);
    } else {
      alert("Comanda excluída com sucesso!");
      setIsDeleteModalOpen(false);
      fetchPedidos();
    }
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen font-sans">
      <header className="mb-10">
        <h1 className="text-5xl font-bold text-center text-custom-pink">D'Ajuda Refeições</h1>
        <nav className="mt-4 mb-6 flex justify-center space-x-6">
          <button 
            onClick={() => setCurrentView("comandas")} 
            className={`px-6 py-2 rounded-lg text-lg font-medium transition-colors 
                        ${currentView === "comandas" 
                          ? "bg-custom-pink text-white shadow-md" 
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
          >
            Pedidos
          </button>
          <button 
            onClick={() => setCurrentView("cardapio")} 
            className={`px-6 py-2 rounded-lg text-lg font-medium transition-colors 
                        ${currentView === "cardapio" 
                          ? "bg-custom-pink text-white shadow-md" 
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}
          >
            Cardápio
          </button>
        </nav>
        {currentView === "comandas" && <p className="text-2xl text-center text-gray-600 mt-2">Painel de Pedidos em Tempo Real</p>}
        {currentView === "cardapio" && <p className="text-2xl text-center text-gray-600 mt-2">Gerenciamento do Cardápio</p>}
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg shadow-sm flex items-center justify-center">
          <AlertTriangle size={20} className="mr-2" /> 
          <span>{error}</span>
          {reconnecting && <Loader2 size={20} className="animate-spin ml-2" />}
        </div>
      )}
      
      {currentView === "comandas" && (
        <>
          <div className="text-center mb-8">
            <button 
              onClick={() => fetchPedidos()} 
              className="px-7 py-3 bg-custom-pink text-white rounded-xl shadow-md hover:bg-pink-700 transition-colors focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-opacity-60 text-lg font-medium"
            >
              Atualizar Pedidos Manualmente
            </button>
          </div>

          {pedidos.length === 0 && !error && (
            <div className="text-center text-gray-500 mt-12">
              <p className="text-3xl mb-2">Nenhum pedido no momento.</p>
              <p className="text-xl">Aguardando novas comandas...</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {pedidos.map((pedido) => (
              <ComandaCard 
                key={pedido.telefone_key} 
                pedido={pedido} 
                onUpdate={handlePedidoUpdate} 
                isNew={newPedidoKeys.has(pedido.telefone_key)}
                onEdit={() => openEditModal(pedido)}
                onDelete={() => openDeleteModal(pedido)}
              />
            ))}
          </div>

          {/* Modal de Edição */}
          {isEditModalOpen && currentPedido && (
            <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex justify-center items-center z-50 p-4">
              <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-2xl font-semibold text-gray-800">Editar Comanda</h3>
                  <button 
                    onClick={() => setIsEditModalOpen(false)}
                    className="text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>
                
                <div className="mb-4">
                  <label htmlFor="nome_cliente" className="block text-sm font-medium text-gray-700 mb-1">Nome do Cliente</label>
                  <input 
                    type="text" 
                    id="nome_cliente" 
                    name="nome_cliente" 
                    value={editedPedido.nome_cliente || ''} 
                    onChange={handleEditInputChange}
                    className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                  />
                </div>
                
                <div className="mb-4">
                  <label htmlFor="comanda" className="block text-sm font-medium text-gray-700 mb-1">Texto da Comanda</label>
                  <textarea 
                    id="comanda" 
                    name="comanda" 
                    value={editedPedido.comanda || ''} 
                    onChange={handleEditInputChange}
                    rows={5}
                    className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                  />
                </div>
                
                <div className="mb-4">
                  <label htmlFor="status_pedido" className="block text-sm font-medium text-gray-700 mb-1">Status do Pedido</label>
                  <select 
                    id="status_pedido" 
                    name="status_pedido" 
                    value={editedPedido.status_pedido || ''} 
                    onChange={handleEditInputChange}
                    className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                  >
                    {statusOptions.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                
                <div className="mb-6">
                  <label htmlFor="pagamento" className="block text-sm font-medium text-gray-700 mb-1">Status do Pagamento</label>
                  <select 
                    id="pagamento" 
                    name="pagamento" 
                    value={editedPedido.pagamento || ''} 
                    onChange={handleEditInputChange}
                    className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-500 focus:border-pink-500 transition-colors"
                  >
                    {pagamentoOptions.map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                
                <div className="flex justify-end space-x-3">
                  <button 
                    onClick={() => setIsEditModalOpen(false)} 
                    disabled={saving}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
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

          {/* Modal de Exclusão */}
          {isDeleteModalOpen && currentPedido && (
            <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
              <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">
                <div className="text-center">
                  <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold mb-3 text-gray-800">Confirmar Exclusão</h3>
                  <p className="text-gray-600 mb-6">
                    Você tem certeza que deseja excluir a comanda de "<strong>{currentPedido.nome_cliente || currentPedido.telefone_key}</strong>"?
                    <br/>Esta ação não poderá ser desfeita.
                  </p>
                </div>
                <div className="flex justify-center space-x-4">
                  <button 
                    onClick={() => setIsDeleteModalOpen(false)} 
                    disabled={saving}
                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleDeletePedido} 
                    disabled={saving}
                    className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg shadow transition-colors flex items-center"
                  >
                    {saving ? <Loader2 size={18} className="mr-1 animate-spin"/> : <Trash2 size={18} className="mr-1"/>}
                    {saving ? 'Excluindo...' : 'Confirmar Exclusão'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {currentView === "cardapio" && (
        <CardapioPage />
      )}

    </div>
  );
}

export default App;

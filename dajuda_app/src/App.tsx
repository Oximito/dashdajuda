import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css"; // Garante que estilos globais sejam carregados
import { supabase } from "./supabaseClient";
import ComandaCard, { Pedido, StatusPedido, StatusPagamento } from "./components/ComandaCard";
import CardapioPage from "./components/CardapioPage";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { AlertTriangle, Loader2, Save, Trash2, XCircle } from "lucide-react";

const notificationSound = "/assets/sounds/notify.mp3";

type View = "comandas" | "cardapio";

// Função auxiliar para garantir que o objeto está em conformidade com a interface Pedido
const ensurePedidoType = (data: any): Pedido => {
  return {
    comanda: data.comanda || ".",
    telefone_key: data.telefone_key || "",
    nome_cliente: data.nome_cliente || "",
    status_pedido: data.status_pedido || "Aguardando",
    pagamento: data.pagamento || "Aguardando pagamento",
    hora_criacao_pedido: data.hora_criacao_pedido || new Date().toISOString(),
  };
};

function App() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newPedidoKeys, setNewPedidoKeys] = useState<Set<string>>(new Set());
  const audioPlayer = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [currentView, setCurrentView] = useState<View>("comandas");
  
  // Estados para controle de reconexão (Comandas)
  const [reconnecting, setReconnecting] = useState<boolean>(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 5000;

  // Estados para os modais de Edição e Exclusão de Comandas
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [currentPedido, setCurrentPedido] = useState<Pedido | null>(null);
  const [editedPedido, setEditedPedido] = useState<Partial<Pedido>>({});
  const [saving, setSaving] = useState<boolean>(false);

  // Opções para selects nos modais
  const statusOptions: StatusPedido[] = ["Aguardando", "Em preparo", "Pronto", "Enviado", "Entregue"];
  const pagamentoOptions: StatusPagamento[] = ["Aguardando pagamento", "Pago"];

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
      const fetchedPedidos = (data || []).map(ensurePedidoType);
      console.log("Pedidos buscados:", fetchedPedidos);
      setPedidos(fetchedPedidos);
    }
  }, []);

  // Função para gerenciar reconexões
  const handleReconnect = useCallback((errorMessage: string) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttemptsRef.current += 1;
      setReconnecting(true);
      setError(null);
      const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current - 1);
      console.log(`Tentativa de reconexão (Comandas) ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS} em ${delay / 1000}s...`);
      reconnectTimeoutRef.current = setTimeout(() => {
        if (currentView === 'comandas') {
          setupRealtimeChannel();
        }
      }, delay);
    } else {
      setReconnecting(false);
      setError(`Erro de conexão em tempo real (Comandas): ${errorMessage} - Falha após ${MAX_RECONNECT_ATTEMPTS} tentativas. Verifique a conexão ou atualize a página.`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  // Função para configurar o canal Realtime das Comandas
  const setupRealtimeChannel = useCallback(() => {
    console.log("Configurando canal Realtime para Comandas...");
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current).catch(console.error);
      channelRef.current = null;
    }

    const handleChanges = (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
      console.log("Mudança recebida do Supabase Realtime (Comandas)!", payload);
      if (payload.eventType === "INSERT" && payload.new.telefone_key) {
        const newKey = payload.new.telefone_key as string;
        const novoPedido = ensurePedidoType(payload.new);
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
            }, 5000);
            return [...prevPedidos, novoPedido].sort((a, b) => new Date(b.hora_criacao_pedido).getTime() - new Date(a.hora_criacao_pedido).getTime());
          } else {
            return prevPedidos.map(p => p.telefone_key === newKey ? novoPedido : p).sort((a, b) => new Date(b.hora_criacao_pedido).getTime() - new Date(a.hora_criacao_pedido).getTime());
          }
        });
      } else if (payload.eventType === "UPDATE") {
        const updatedKey = payload.new.telefone_key as string;
        const pedidoAtualizado = ensurePedidoType(payload.new);
        setPedidos(prevPedidos => prevPedidos.map(p => p.telefone_key === updatedKey ? pedidoAtualizado : p).sort((a, b) => new Date(b.hora_criacao_pedido).getTime() - new Date(a.hora_criacao_pedido).getTime()));
      } else if (payload.eventType === "DELETE") {
        const deletedKey = payload.old.telefone_key as string;
        setPedidos(prevPedidos => prevPedidos.filter(p => p.telefone_key !== deletedKey));
      }
    };

    channelRef.current = supabase
      .channel("comandas_realtime_channel")
      .on("postgres_changes", { event: "*", schema: "public", table: "Comandas" }, handleChanges)
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          console.log("Conectado ao canal Realtime do Supabase (Comandas)!");
          setError(null);
          setReconnecting(false);
          reconnectAttemptsRef.current = 0;
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          const errorMsg = status === "CHANNEL_ERROR" ? (err?.message || "Erro desconhecido") : status;
          console.error(`Erro/Status no canal Realtime (Comandas): ${errorMsg}`);
          handleReconnect(errorMsg);
        } else if (status === "CLOSED") {
          console.log("Canal Realtime (Comandas) fechado. Status:", status);
          if (currentView === 'comandas' && !reconnecting) {
            // Opcional: Logar warning ou tentar reconexão suave
          }
        }
      });
  }, [currentView, handleReconnect]);

  useEffect(() => {
    // Dependência para handleReconnect
  }, [setupRealtimeChannel]);

  // Efeito principal para gerenciar conexão/desconexão
  useEffect(() => {
    if (currentView === "comandas") {
      console.log("Entrando na view Comandas...");
      fetchPedidos('view change');
      setupRealtimeChannel();
      audioPlayer.current = new Audio(notificationSound);
      audioPlayer.current.load();
      return () => {
        console.log("Saindo da view Comandas...");
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
        if (channelRef.current) {
          supabase.removeChannel(channelRef.current).catch(console.error);
          channelRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        setReconnecting(false);
      };
    } else {
      console.log("Mudando para view Cardápio...");
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current).catch(console.error);
        channelRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      reconnectAttemptsRef.current = 0;
      setReconnecting(false);
      if (error?.includes("(Comandas)")) {
        setError(null);
      }
    }
  }, [currentView, fetchPedidos, setupRealtimeChannel, error]); // Adicionado 'error' como dependência

  // Funções para o modal de edição de Comanda
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
    }
  };

  // Funções para o modal de exclusão de Comanda
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
    }
  };

  return (
    <div className="p-4 sm:p-6 bg-gray-50 min-h-screen font-sans">
      {/* Cabeçalho */}
      <header className="mb-8">
        <h1 className="text-4xl sm:text-5xl font-bold text-center text-pink-600">D'Ajuda Refeições</h1>
        {/* Navegação entre Abas */}
        <nav className="mt-4 mb-6 flex justify-center space-x-4 sm:space-x-6">
          <button 
            onClick={() => setCurrentView("comandas")} 
            className={`px-4 py-2 sm:px-6 sm:py-2 rounded-lg text-base sm:text-lg font-medium transition-all duration-150 
                        ${currentView === "comandas" 
                          ? "bg-pink-600 text-white shadow-md scale-105"
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`
          }>
            Pedidos
          </button>
          <button 
            onClick={() => setCurrentView("cardapio")} 
            className={`px-4 py-2 sm:px-6 sm:py-2 rounded-lg text-base sm:text-lg font-medium transition-all duration-150 
                        ${currentView === "cardapio" 
                          ? "bg-pink-600 text-white shadow-md scale-105"
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`
          }>
            Cardápio
          </button>
        </nav>
        {/* Título da Aba Atual */}
        {currentView === "comandas" && <p className="text-xl sm:text-2xl text-center text-gray-600">Painel de Pedidos</p>}
        {currentView === "cardapio" && <p className="text-xl sm:text-2xl text-center text-gray-600">Gerenciamento do Cardápio</p>}
      </header>

      {/* Mensagem de Erro Global */}
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
                isNew={newPedidoKeys.has(pedido.telefone_key)}
                onEdit={() => openEditModal(pedido)}
                onDelete={() => openDeleteModal(pedido)}
              />
            ))}
          </div>

          {/* **REFORMULAÇÃO: Modal de Edição de Comanda - Estilo "Apple"** */}
          {isEditModalOpen && currentPedido && (
            <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
                {/* Cabeçalho do Modal */}
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-xl font-semibold text-gray-800">Editar Comanda</h3>
                  <p className="text-sm text-gray-500">Pedido de: {currentPedido.nome_cliente || currentPedido.telefone_key}</p>
                </div>
                
                {/* Conteúdo Rolável do Modal */}
                <div className="p-6 overflow-y-auto flex-grow space-y-4"> 
                  <div>
                    <label htmlFor="edit-nome_cliente" className="label-style">Nome do Cliente</label>
                    <input 
                      type="text" 
                      id="edit-nome_cliente"
                      name="nome_cliente"
                      value={editedPedido.nome_cliente || ''}
                      onChange={handleEditInputChange}
                      className="input-field" 
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-comanda" className="label-style">Comanda</label>
                    <textarea 
                      id="edit-comanda"
                      name="comanda"
                      value={editedPedido.comanda || ''}
                      onChange={handleEditInputChange}
                      className="input-field h-40 resize-none" // Altura fixa e sem resize
                    />
                  </div>
                  <div>
                    <label htmlFor="edit-status_pedido" className="label-style">Status Pedido</label>
                    <select 
                      id="edit-status_pedido"
                      name="status_pedido"
                      value={editedPedido.status_pedido || ''}
                      onChange={handleEditInputChange}
                      className="input-field"
                    >
                      {statusOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="edit-pagamento" className="label-style">Status Pagamento</label>
                    <select 
                      id="edit-pagamento"
                      name="pagamento"
                      value={editedPedido.pagamento || ''}
                      onChange={handleEditInputChange}
                      className="input-field"
                    >
                      {pagamentoOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                </div>
                
                {/* Rodapé Fixo do Modal */}
                <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3 rounded-b-xl">
                  <button 
                    type="button" 
                    onClick={() => setIsEditModalOpen(false)} 
                    disabled={saving}
                    className="btn-secondary" // Usando classe global
                  >
                    <XCircle size={18} className="inline mr-1"/> Cancelar
                  </button>
                  <button 
                    type="button" 
                    onClick={handleSaveEdit} 
                    disabled={saving}
                    className="btn-primary bg-blue-600 hover:bg-blue-700 focus:ring-blue-400" // Usando classe global, cor azul
                  >
                    {saving ? <Loader2 size={18} className="inline mr-1 animate-spin"/> : <Save size={18} className="inline mr-1"/>}
                    {saving ? 'Salvando...' : 'Salvar Alterações'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal de Exclusão de Comanda - Estilo mantido */}
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
                  <button onClick={() => setIsDeleteModalOpen(false)} disabled={saving} className="btn-secondary">
                    Cancelar
                  </button>
                  <button onClick={handleDeletePedido} disabled={saving} className="btn-danger">
                    {saving ? <Loader2 size={18} className="inline mr-1 animate-spin"/> : <Trash2 size={18} className="inline mr-1"/>}
                    {saving ? 'Excluindo...' : 'Confirmar Exclusão'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Conteúdo da Aba Cardápio */}
      {currentView === "cardapio" && <CardapioPage />}
    </div>
  );
}

export default App;


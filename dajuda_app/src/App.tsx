import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import { supabase } from "./supabaseClient";
import ComandaCard, { Pedido, StatusPedido, StatusPagamento } from "./components/ComandaCard"; // Importado StatusPedido, StatusPagamento
import CardapioPage from "./components/CardapioPage";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { AlertTriangle, Loader2, XCircle, Save, Trash2 } from "lucide-react"; // Adicionado XCircle, Save, Trash2

// Removido som de notificação conforme solicitado
// const notificationSound = "/assets/sounds/notify.mp3";

type View = "comandas" | "cardapio";

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY = 5000; // 5 segundos

// Componente Modal Genérico para Confirmação
interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode; // Permite JSX na mensagem
  confirmText?: string;
  cancelText?: string;
  isSaving?: boolean;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  isSaving = false,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md">
        <div className="text-center">
          <AlertTriangle size={48} className="text-red-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-3 text-gray-800">{title}</h3>
          <div className="text-gray-600 mb-6">{message}</div>
        </div>
        <div className="flex justify-center space-x-4">
          <button onClick={onClose} disabled={isSaving} className="btn-secondary">
            {cancelText}
          </button>
          <button onClick={onConfirm} disabled={isSaving} className="btn-danger">
            {isSaving ? <Loader2 size={18} className="inline mr-1 animate-spin" /> : <Trash2 size={18} className="inline mr-1" />}
            {isSaving ? "Processando..." : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

// Componente Modal para Edição de Comanda
interface EditComandaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (pedidoEditado: Pedido) => Promise<void>;
  pedido: Pedido | null;
  isSaving?: boolean;
}

const EditComandaModal: React.FC<EditComandaModalProps> = ({
  isOpen,
  onClose,
  onSave,
  pedido,
  isSaving = false,
}) => {
  const [editedPedido, setEditedPedido] = useState<Pedido | null>(null);

  useEffect(() => {
    if (pedido) {
      setEditedPedido({ ...pedido }); // Clona o pedido para edição local
    } else {
      setEditedPedido(null);
    }
  }, [pedido]);

  if (!isOpen || !editedPedido) return null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditedPedido(prev => prev ? { ...prev, [name]: value } : null);
  };

  const handleSaveClick = async () => {
    if (editedPedido) {
      await onSave(editedPedido);
    }
  };

  const formFieldClasses = "block w-full p-2 border-2 border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-pink-500 focus:border-pink-500 text-sm bg-white";

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 backdrop-blur-sm flex justify-center items-center z-50 p-4">
      <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-2xl font-semibold mb-6 text-gray-800">Editar Comanda</h3>
        <form onSubmit={(e) => { e.preventDefault(); handleSaveClick(); }}>
          <div className="mb-4">
            <label htmlFor="nome_cliente_edit" className="block text-sm font-medium text-gray-700 mb-1">Nome do Cliente</label>
            <input
              type="text"
              name="nome_cliente"
              id="nome_cliente_edit"
              value={editedPedido.nome_cliente || ''}
              onChange={handleInputChange}
              required
              className={formFieldClasses}
            />
          </div>
          <div className="mb-4">
            <label htmlFor="comanda_edit" className="block text-sm font-medium text-gray-700 mb-1">Comanda Detalhada</label>
            <textarea
              name="comanda"
              id="comanda_edit"
              value={editedPedido.comanda || ''}
              onChange={handleInputChange}
              required
              rows={8} // Aumentado para melhor visualização
              className={formFieldClasses}
            />
          </div>
          <div className="mb-4">
            <label htmlFor="status_pedido_edit" className="block text-sm font-medium text-gray-700 mb-1">Status do Pedido</label>
            <select
              name="status_pedido"
              id="status_pedido_edit"
              value={editedPedido.status_pedido}
              onChange={handleInputChange}
              required
              className={formFieldClasses}
            >
              {ComandaCard.statusOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div className="mb-6">
            <label htmlFor="pagamento_edit" className="block text-sm font-medium text-gray-700 mb-1">Status do Pagamento</label>
            <select
              name="pagamento"
              id="pagamento_edit"
              value={editedPedido.pagamento}
              onChange={handleInputChange}
              required
              className={formFieldClasses}
            >
              {ComandaCard.pagamentoOptions.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end space-x-3">
            <button type="button" onClick={onClose} disabled={isSaving} className="btn-secondary">
              <XCircle size={18} className="inline mr-1" /> Cancelar
            </button>
            <button type="submit" disabled={isSaving} className="btn-primary bg-blue-500 hover:bg-blue-600">
              {isSaving ? <Loader2 size={18} className="inline mr-1 animate-spin" /> : <Save size={18} className="inline mr-1" />}
              {isSaving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Adiciona as opções estáticas ao componente ComandaCard para acesso no App.tsx
ComandaCard.statusOptions = ["Aguardando", "Em preparo", "Pronto", "Enviado", "Entregue"];
ComandaCard.pagamentoOptions = ["Aguardando pagamento", "Pago"];

function App() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newPedidoKeys, setNewPedidoKeys] = useState<Set<string>>(new Set());
  // const audioPlayer = useRef<HTMLAudioElement | null>(null); // Removido
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [currentView, setCurrentView] = useState<View>("comandas");
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<number>(0);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);

  // Estados para os modais
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [pedidoParaEditar, setPedidoParaEditar] = useState<Pedido | null>(null);
  const [pedidoParaDeletar, setPedidoParaDeletar] = useState<Pedido | null>(null);
  const [isSavingModal, setIsSavingModal] = useState<boolean>(false); // Para indicar loading nos modais

  // Removida função playNotificationSound

  const fetchPedidos = useCallback(async (source?: string, isNewInsert: boolean = false, insertedKey?: string) => {
    console.log(`[App] Buscando pedidos... (Origem: ${source || "desconhecida"})`);
    const { data, error: fetchError } = await supabase
      .from("Comandas")
      .select("*, hora_criacao_pedido")
      .order("hora_criacao_pedido", { ascending: false });

    if (fetchError) {
      console.error("[App] Erro ao buscar pedidos:", fetchError);
      setPedidos([]);
    } else {
      const fetchedPedidos = data as Pedido[];
      console.log("[App] Pedidos buscados:", fetchedPedidos.length);
      setPedidos(fetchedPedidos);

      if (isNewInsert && insertedKey) {
        console.log("[App] Novo pedido inserido, destacando:", insertedKey);
        if (!pedidos.some(p => p.telefone_key === insertedKey)) {
            // playNotificationSound(); // Removido
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setupComandasRealtimeSubscription = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current).catch(console.error);
      channelRef.current = null;
    }
    if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
    }

    console.log("[App] Tentando conectar ao canal Realtime (Comandas)...");
    setIsConnecting(true);
    setError(null);

    const channel = supabase.channel("comandas_realtime_channel");

    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "Comandas" },
      (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
        console.log("[App] Mudança recebida do Supabase Realtime (Comandas)!", payload);
        // Atualiza a lista inteira em qualquer mudança para simplicidade
        // Poderia ser otimizado para atualizar/inserir/remover apenas o item afetado
        fetchPedidos("realtime update");
      }
    ).subscribe((status: "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR", err?: Error) => {
      setIsConnecting(false);
      if (status === "SUBSCRIBED") {
        console.log("[App] Conectado ao canal Realtime (Comandas)!");
        setError(null);
        retryCountRef.current = 0;
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
            retryTimeoutRef.current = null;
        }
        fetchPedidos("after subscribe");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.error(`[App] Erro/Status no canal Realtime (Comandas): ${status}`, err);
        setError(`Erro de conexão em tempo real (Comandas): ${status} - ${err?.message || "Tentando reconectar..."}`);
        channelRef.current = null;

        if (retryCountRef.current < MAX_RETRIES) {
          const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCountRef.current);
          console.log(`[App] Tentando reconectar Comandas em ${delay / 1000} segundos... (Tentativa ${retryCountRef.current + 1}/${MAX_RETRIES})`);
          setIsConnecting(true);
          retryTimeoutRef.current = setTimeout(() => {
            retryCountRef.current++;
            setupComandasRealtimeSubscription();
          }, delay);
        } else {
          console.error("[App] Máximo de tentativas de reconexão (Comandas) atingido.");
          setError("Falha ao reconectar ao serviço de atualizações em tempo real (Comandas) após múltiplas tentativas. Atualize manualmente.");
          setIsConnecting(false);
        }
      }
    });

    channelRef.current = channel;

  }, [fetchPedidos]);

  useEffect(() => {
    if (currentView === "comandas") {
        console.log("[App] View mudou para Comandas, iniciando fetch e Realtime.");
        fetchPedidos("view change");
        setupComandasRealtimeSubscription();

        // Removida configuração do audioPlayer

        return () => {
          console.log("[App] Saindo da view Comandas ou desmontando App, removendo canal Realtime.");
          if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
          }
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
              .then(status => console.log("[App] Canal Realtime (Comandas) removido no cleanup, status:", status))
              .catch(console.error);
            channelRef.current = null;
          }
          // Removida limpeza do audioPlayer
        };
    } else {
        console.log("[App] View mudou para Cardápio, garantindo remoção do canal Realtime (Comandas).");
        if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current);
        }
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
              .then(status => console.log("[App] Canal Realtime (Comandas) removido ao mudar de view, status:", status))
              .catch(console.error);
            channelRef.current = null;
        }
        setError(null);
        setPedidos([]);
        setNewPedidoKeys(new Set());
    }
  }, [currentView, fetchPedidos, setupComandasRealtimeSubscription]);

  // Callback para atualização de status/pagamento vindo do ComandaCard
  const handlePedidoUpdate = () => {
    console.log("[App] Atualização de status/pagamento individual concluída, re-buscando todos os pedidos.");
    fetchPedidos("single update callback");
  };

  // --- Funções para Editar e Excluir Comandas ---

  const handleOpenEditModal = (pedido: Pedido) => {
    setPedidoParaEditar(pedido);
    setIsEditModalOpen(true);
  };

  const handleCloseEditModal = () => {
    setIsEditModalOpen(false);
    setPedidoParaEditar(null);
  };

  const handleSaveEditedComanda = async (pedidoEditado: Pedido) => {
    if (!pedidoParaEditar) return;
    setIsSavingModal(true);
    const { error: updateError } = await supabase
      .from("Comandas")
      .update({
        nome_cliente: pedidoEditado.nome_cliente,
        comanda: pedidoEditado.comanda,
        status_pedido: pedidoEditado.status_pedido,
        pagamento: pedidoEditado.pagamento,
      })
      .eq("telefone_key", pedidoParaEditar.telefone_key);

    setIsSavingModal(false);
    if (updateError) {
      console.error("Erro ao salvar alterações da comanda:", updateError);
      alert(`Erro ao salvar alterações: ${updateError.message}`);
    } else {
      alert("Comanda atualizada com sucesso!");
      handleCloseEditModal();
      fetchPedidos("after edit save"); // Atualiza a lista
    }
  };

  const handleOpenDeleteModal = (pedido: Pedido) => {
    setPedidoParaDeletar(pedido);
    setIsDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    setIsDeleteModalOpen(false);
    setPedidoParaDeletar(null);
  };

  const handleConfirmDeleteComanda = async () => {
    if (!pedidoParaDeletar) return;
    setIsSavingModal(true);
    const { error: deleteError } = await supabase
      .from("Comandas")
      .delete()
      .eq("telefone_key", pedidoParaDeletar.telefone_key);

    setIsSavingModal(false);
    if (deleteError) {
      console.error("Erro ao excluir comanda:", deleteError);
      alert(`Erro ao excluir comanda: ${deleteError.message}`);
    } else {
      alert("Comanda excluída com sucesso!");
      handleCloseDeleteModal();
      fetchPedidos("after delete"); // Atualiza a lista
    }
  };

  // --- Renderização ---

  return (
    <div className="p-6 bg-gray-50 min-h-screen font-sans">
      <header className="mb-10">
        <h1 className="text-5xl font-bold text-center text-custom-pink">D’Ajuda Refeições</h1>
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
        <div className="text-red-600 text-center mb-6 p-4 bg-red-100 rounded-lg shadow flex items-center justify-center">
            <AlertTriangle size={20} className="mr-2" /> {error}
        </div>
      )}
      {isConnecting && !error && currentView === "comandas" && (
        <div className="text-blue-600 text-center mb-6 p-4 bg-blue-100 rounded-lg shadow flex items-center justify-center">
            <Loader2 size={20} className="animate-spin mr-2" /> Conectando às atualizações em tempo real...
        </div>
      )}

      {currentView === "comandas" && (
        <>
          <div className="text-center mb-8">
            <button
              onClick={() => fetchPedidos("manual refresh")}
              className="px-7 py-3 bg-custom-pink text-white rounded-xl shadow-md hover:bg-pink-700 transition-colors focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-opacity-60 text-lg font-medium"
            >
              Atualizar Pedidos Manualmente
            </button>
          </div>

          {pedidos.length === 0 && !error && !isConnecting && (
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
                onUpdate={handlePedidoUpdate} // Para status/pagamento
                onEdit={handleOpenEditModal}   // Para abrir modal de edição
                onDelete={handleOpenDeleteModal} // Para abrir modal de exclusão
                isNew={newPedidoKeys.has(pedido.telefone_key)}
              />
            ))}
          </div>
        </>
      )}

      {currentView === "cardapio" && (
        <CardapioPage />
      )}

      {/* Modais de Edição e Exclusão */}
      <EditComandaModal
        isOpen={isEditModalOpen}
        onClose={handleCloseEditModal}
        onSave={handleSaveEditedComanda}
        pedido={pedidoParaEditar}
        isSaving={isSavingModal}
      />

      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={handleCloseDeleteModal}
        onConfirm={handleConfirmDeleteComanda}
        title="Confirmar Exclusão"
        message={
          <p>
            Você tem certeza que deseja excluir a comanda de "<strong>{pedidoParaDeletar?.nome_cliente || pedidoParaDeletar?.telefone_key}</strong>"?
            <br />Esta ação não poderá ser desfeita.
          </p>
        }
        confirmText="Excluir Comanda"
        isSaving={isSavingModal}
      />

    </div>
  );
}

export default App;


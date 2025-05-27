import { useState, useEffect, useRef, useCallback } from "react";
import "./App.css";
import { supabase } from "./supabaseClient";
import ComandaCard, { Pedido, StatusPedido, StatusPagamento } from "./components/ComandaCard"; // Importar tipos StatusPedido e StatusPagamento
import CardapioPage from "./components/CardapioPage";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
// Importando ícones necessários - REMOVIDO X e Edit3 não utilizados
import { AlertTriangle, Loader2, Save, Trash2, XCircle } from "lucide-react";

const notificationSound = "/assets/sounds/notify.mp3";

type View = "comandas" | "cardapio";

// Função auxiliar para garantir que o objeto está em conformidade com a interface Pedido
const ensurePedidoType = (data: any): Pedido => {
  return {
    comanda: data.comanda || ".", // Default seguro
    telefone_key: data.telefone_key || "", // Default seguro
    nome_cliente: data.nome_cliente || "", // Default seguro
    status_pedido: data.status_pedido || "Aguardando", // Default seguro
    pagamento: data.pagamento || "Aguardando pagamento", // Default seguro
    hora_criacao_pedido: data.hora_criacao_pedido || new Date().toISOString(), // Default seguro
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
  const RECONNECT_DELAY = 5000; // Base delay 5 segundos

  // Estados para os modais de Edição e Exclusão de Comandas
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  const [currentPedido, setCurrentPedido] = useState<Pedido | null>(null);
  const [editedPedido, setEditedPedido] = useState<Partial<Pedido>>({});
  const [saving, setSaving] = useState<boolean>(false); // Para feedback de loading nos modais

  // Opções para selects nos modais (poderiam vir do DB se necessário)
  const statusOptions: StatusPedido[] = ["Aguardando", "Em preparo", "Pronto", "Enviado", "Entregue"];
  const pagamentoOptions: StatusPagamento[] = ["Aguardando pagamento", "Pago"];

  const playNotificationSound = () => {
    if (audioPlayer.current) {
      audioPlayer.current.play().catch(e => console.error("Erro ao tocar som de notificação:", e));
    }
  };

  // Busca inicial e manual de pedidos - Usando useCallback para otimização
  const fetchPedidos = useCallback(async (source?: string) => {
    console.log(`Buscando pedidos... (Origem: ${source || 'desconhecida'})`);
    const { data, error: fetchError } = await supabase
      .from("Comandas")
      .select("*, hora_criacao_pedido") // Inclui a coluna de timestamp
      .order("hora_criacao_pedido", { ascending: false }); // Ordena pelos mais recentes

    if (fetchError) {
      console.error("Erro ao buscar pedidos:", fetchError);
      setError(`Falha ao carregar pedidos: ${fetchError.message}`);
      setPedidos([]); // Limpa pedidos em caso de erro
    } else {
      // Garante a tipagem correta ao buscar
      const fetchedPedidos = (data || []).map(ensurePedidoType);
      console.log("Pedidos buscados:", fetchedPedidos);
      setPedidos(fetchedPedidos);
      // Limpa o erro *apenas* se a busca for bem-sucedida
      // Não limpa erros de realtime aqui para não esconder problemas de conexão
      // setError(null); 
    }
  }, []);

  // Função para gerenciar reconexões com backoff exponencial - Usando useCallback
  // Definindo handleReconnect antes de setupRealtimeChannel para evitar erro de declaração
  const handleReconnect = useCallback((errorMessage: string) => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttemptsRef.current += 1;
      setReconnecting(true);
      setError(null); // Limpa erro principal enquanto tenta reconectar
      
      // Calcula delay exponencial
      const delay = RECONNECT_DELAY * Math.pow(2, reconnectAttemptsRef.current - 1);
      console.log(`Tentativa de reconexão (Comandas) ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS} em ${delay / 1000}s...`);
      
      // Agenda a próxima tentativa
      reconnectTimeoutRef.current = setTimeout(() => {
        // Só tenta reconectar se ainda estiver na view de comandas
        if (currentView === 'comandas') { 
            // Chama setupRealtimeChannel aqui, que agora está definida abaixo
            setupRealtimeChannel(); 
        }
      }, delay);
    } else {
      // Atingiu o limite de tentativas
      setReconnecting(false);
      setError(`Erro de conexão em tempo real (Comandas): ${errorMessage} - Falha após ${MAX_RECONNECT_ATTEMPTS} tentativas. Verifique a conexão ou atualize a página.`);
    }
  // Depende de currentView e setupRealtimeChannel (que será definida abaixo)
  // eslint-disable-next-line react-hooks/exhaustive-deps 
  }, [currentView]); // Removido setupRealtimeChannel daqui temporariamente

  // Função para configurar o canal Realtime das Comandas - Usando useCallback
  const setupRealtimeChannel = useCallback(() => {
    console.log("Configurando canal Realtime para Comandas...");
    // Remove canal existente antes de criar um novo (evita duplicação)
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
        .then(() => console.log('Canal Realtime (Comandas) removido antes de reconectar'))
        .catch(console.error);
      channelRef.current = null;
    }

    const handleChanges = (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
      console.log("Mudança recebida do Supabase Realtime (Comandas)!", payload);
      // Lógica otimizada para atualizar o estado baseado no evento
      if (payload.eventType === "INSERT" && payload.new.telefone_key) {
        const newKey = payload.new.telefone_key as string;
        const novoPedido = ensurePedidoType(payload.new); // Garante a tipagem correta
        setPedidos(prevPedidos => {
            // Verifica se o pedido já existe no estado para evitar duplicação e som repetido
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
                // Adiciona o novo pedido (já tipado) e reordena
                return [...prevPedidos, novoPedido].sort((a, b) => new Date(b.hora_criacao_pedido).getTime() - new Date(a.hora_criacao_pedido).getTime());
            } else {
                // Se já existe (caso raro), apenas atualiza (já tipado)
                return prevPedidos.map(p => p.telefone_key === newKey ? novoPedido : p).sort((a, b) => new Date(b.hora_criacao_pedido).getTime() - new Date(a.hora_criacao_pedido).getTime());
            }
        });
      } else if (payload.eventType === "UPDATE") {
          const updatedKey = payload.new.telefone_key as string;
          const pedidoAtualizado = ensurePedidoType(payload.new); // Garante a tipagem correta
          // Atualiza o pedido existente (já tipado) e reordena
          setPedidos(prevPedidos => prevPedidos.map(p => p.telefone_key === updatedKey ? pedidoAtualizado : p).sort((a, b) => new Date(b.hora_criacao_pedido).getTime() - new Date(a.hora_criacao_pedido).getTime()));
      } else if (payload.eventType === "DELETE") {
          const deletedKey = payload.old.telefone_key as string;
          // Remove o pedido do estado
          setPedidos(prevPedidos => prevPedidos.filter(p => p.telefone_key !== deletedKey));
      }
    };

    // Cria e subscreve ao canal
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
          reconnectAttemptsRef.current = 0; // Reseta tentativas
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Trata erros e timeouts que exigem reconexão
          const errorMsg = status === "CHANNEL_ERROR" ? (err?.message || "Erro desconhecido") : status;
          console.error(`Erro/Status no canal Realtime (Comandas): ${errorMsg}`);
          handleReconnect(errorMsg); // Inicia lógica de reconexão
        } else if (status === "CLOSED") {
          // Canal fechado - pode ser normal ou inesperado.
          console.log("Canal Realtime (Comandas) fechado. Status:", status);
          // Se a view ainda for 'comandas' e não estiver reconectando, pode indicar um problema.
          // Não força retry loop aqui para evitar consumo excessivo.
          if (currentView === 'comandas' && !reconnecting) {
             // Poderia logar um warning ou tentar uma reconexão suave se necessário.
             // setError("Conexão em tempo real (Comandas) fechada inesperadamente.");
          }
        }
      });
  // Depende de currentView e handleReconnect
  }, [currentView, handleReconnect]);

  // Adiciona setupRealtimeChannel como dependência de handleReconnect após sua definição
  useEffect(() => {
    // Este efeito existe apenas para satisfazer a dependência de handleReconnect
    // A lógica real de chamada está em handleReconnect e no useEffect principal
  }, [setupRealtimeChannel]);

  // Efeito principal para gerenciar a conexão/desconexão do canal ao mudar de view
  useEffect(() => {
    if (currentView === "comandas") {
        console.log("Entrando na view Comandas, buscando pedidos e configurando Realtime...");
        fetchPedidos('view change'); // Busca inicial ao entrar na view
        setupRealtimeChannel(); // Configura o canal

        // Configura o player de áudio
        audioPlayer.current = new Audio(notificationSound);
        audioPlayer.current.load();

        // Função de limpeza ao desmontar ou mudar de view
        return () => {
          console.log("Saindo da view Comandas, limpando timeouts e removendo canal Realtime...");
          // Limpa timeout de reconexão pendente
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          // Remove o canal Realtime
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
              .then(status => console.log("Canal Realtime (Comandas) removido ao sair da view, status:", status))
              .catch(console.error);
            channelRef.current = null;
          }
          reconnectAttemptsRef.current = 0; // Reseta contador de tentativas
          setReconnecting(false);
          // Não limpa o erro aqui, pode ser útil manter se houve falha persistente
        };
    } else {
        // Se não está na view de comandas, garante que o canal de comandas está fechado
        console.log("Mudando para view Cardápio, garantindo que canal de Comandas está fechado.");
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current)
              .then(status => console.log("Canal Realtime (Comandas) removido ao mudar para Cardápio, status:", status))
              .catch(console.error);
            channelRef.current = null;
        }
        // Limpa timeouts pendentes
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        reconnectAttemptsRef.current = 0;
        setReconnecting(false);
        // Limpa erros *específicos* de comandas ao mudar de view
        if (error?.includes("(Comandas)")) {
            setError(null); 
        }
    }
  // Dependências do efeito: currentView, fetchPedidos, setupRealtimeChannel
  }, [currentView, fetchPedidos, setupRealtimeChannel]);

  // Funções para o modal de edição de Comanda
  const openEditModal = (pedido: Pedido) => {
    setCurrentPedido(pedido); // Guarda o pedido original
    // Preenche o estado de edição com os valores atuais
    setEditedPedido({
      nome_cliente: pedido.nome_cliente,
      comanda: pedido.comanda,
      status_pedido: pedido.status_pedido,
      pagamento: pedido.pagamento
    });
    setIsEditModalOpen(true);
  };

  // Atualiza o estado de edição conforme o usuário digita/seleciona
  const handleEditInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setEditedPedido(prev => ({ ...prev, [name]: value }));
  };

  // Salva as alterações da comanda editada
  const handleSaveEdit = async () => {
    if (!currentPedido) return;
    
    setSaving(true); // Ativa feedback de loading
    const { error: updateError } = await supabase
      .from("Comandas")
      .update({
        nome_cliente: editedPedido.nome_cliente,
        comanda: editedPedido.comanda,
        status_pedido: editedPedido.status_pedido,
        pagamento: editedPedido.pagamento
      })
      .eq("telefone_key", currentPedido.telefone_key); // Condição para atualizar o pedido correto
    
    setSaving(false); // Desativa feedback de loading
    
    if (updateError) {
      console.error("Erro ao atualizar comanda:", updateError);
      alert(`Falha ao atualizar comanda: ${updateError.message}`);
    } else {
      alert("Comanda atualizada com sucesso!");
      setIsEditModalOpen(false); // Fecha o modal
      // O Realtime deve atualizar a lista automaticamente
      // fetchPedidos('after edit save'); // Poderia forçar um fetch se o Realtime falhar
    }
  };

  // Funções para o modal de exclusão de Comanda
  const openDeleteModal = (pedido: Pedido) => {
    setCurrentPedido(pedido); // Guarda o pedido a ser excluído
    setIsDeleteModalOpen(true);
  };

  // Executa a exclusão da comanda
  const handleDeletePedido = async () => {
    if (!currentPedido) return;
    
    setSaving(true); // Ativa feedback de loading
    const { error: deleteError } = await supabase
      .from("Comandas")
      .delete()
      .eq("telefone_key", currentPedido.telefone_key); // Condição para excluir o pedido correto
    
    setSaving(false); // Desativa feedback de loading
    
    if (deleteError) {
      console.error("Erro ao excluir comanda:", deleteError);
      alert(`Falha ao excluir comanda: ${deleteError.message}`);
    } else {
      alert("Comanda excluída com sucesso!");
      setIsDeleteModalOpen(false); // Fecha o modal
      // O Realtime deve atualizar a lista automaticamente
      // fetchPedidos('after delete'); // Poderia forçar um fetch se o Realtime falhar
    }
  };

  // Renderização principal - CORRIGIDO ERROS DE SINTAXE JSX e TIPAGEM
  return (
    <div className="p-4 sm:p-6 bg-gray-50 min-h-screen font-sans">
      {/* Cabeçalho */}
      <header className="mb-8">
        <h1 className="text-4xl sm:text-5xl font-bold text-center text-pink-600">D'Ajuda Refeições</h1>
        {/* Navegação entre Abas - Estilo minimalista */}
        <nav className="mt-4 mb-6 flex justify-center space-x-4 sm:space-x-6">
          <button 
            onClick={() => setCurrentView("comandas")} 
            className={`px-4 py-2 sm:px-6 sm:py-2 rounded-lg text-base sm:text-lg font-medium transition-all duration-150 
                        ${currentView === "comandas" 
                          ? "bg-pink-600 text-white shadow-md scale-105" // Botão ativo
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"}` // Botão inativo
          }>
            Pedidos
          </button>
          <button 
            onClick={() => setCurrentView("cardapio")} 
            className={`px-4 py-2 sm:px-6 sm:py-2 rounded-lg text-base sm:text-lg font-medium transition-all duration-150 
                        ${currentView === "cardapio" 
                          ? "bg-pink-600 text-white shadow-md scale-105" // Botão ativo
                          : "bg-gray-200 text-gray-700 hover:bg-gray-300"}` // Botão inativo
          }>
            Cardápio
          </button>
        </nav> {/* Fechamento da tag nav CORRIGIDO */} 
        {/* Título da Aba Atual */}
        {currentView === "comandas" && <p className="text-xl sm:text-2xl text-center text-gray-600">Painel de Pedidos</p>}
        {currentView === "cardapio" && <p className="text-xl sm:text-2xl text-center text-gray-600">Gerenciamento do Cardápio</p>}
      </header> {/* Fechamento da tag header CORRIGIDO */} 

      {/* Mensagem de Erro Global (Não bloqueante) */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg shadow-sm flex items-center justify-center">
          <AlertTriangle size={20} className="mr-2 flex-shrink-0" /> 
          <span className="flex-grow text-center text-sm sm:text-base">{error}</span>
          {/* Mostra spinner se estiver tentando reconectar */}
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

          {/* Grid de Comandas - Layout responsivo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
            {pedidos.map((pedido) => (
              <ComandaCard 
                key={pedido.telefone_key} 
                pedido={pedido} 
                isNew={newPedidoKeys.has(pedido.telefone_key)}
                // Passa as funções para abrir os modais
                onEdit={() => openEditModal(pedido)}
                onDelete={() => openDeleteModal(pedido)}
              />
            ))}
          </div>

          {/* Modal de Edição de Comanda - Estilo "Apple" com footer fixo */}
          {isEditModalOpen && currentPedido && (
            <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
                {/* Cabeçalho do Modal */}
                <div className="p-6 border-b border-gray-200">
                  <h3 className="text-xl font-semibold text-gray-800">Editar Comanda</h3>
                  <p className="text-sm text-gray-500">Pedido de: {currentPedido.nome_cliente || currentPedido.telefone_key}</p>
                </div>
                
                {/* Conteúdo Rolável do Modal */}
                <div className="p-6 overflow-y-auto flex-grow">
                  <div className="mb-4">
                    <label htmlFor="edit-nome_cliente" className="block text-sm font-medium text-gray-700 mb-1">Nome do Cliente</label>
                    <input 
                      type="text" 
                      id="edit-nome_cliente"
                      name="nome_cliente"
                      value={editedPedido.nome_cliente || ''}
                      onChange={handleEditInputChange}
                      className="input-field" 
                    />
                  </div>
                  <div className="mb-4">
                    <label htmlFor="edit-comanda" className="block text-sm font-medium text-gray-700 mb-1">Comanda</label>
                    <textarea 
                      id="edit-comanda"
                      name="comanda"
                      value={editedPedido.comanda || ''}
                      onChange={handleEditInputChange}
                      rows={6} // Aumentado para melhor visualização
                      className="input-field"
                    />
                  </div>
                  <div className="mb-4">
                    <label htmlFor="edit-status_pedido" className="block text-sm font-medium text-gray-700 mb-1">Status Pedido</label>
                    <select 
                      id="edit-status_pedido"
                      name="status_pedido"
                      value={editedPedido.status_pedido || ''}
                      onChange={handleEditInputChange}
                      className="input-field"
                    >
                      {statusOptions.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                  <div className="mb-4">
                    <label htmlFor="edit-pagamento" className="block text-sm font-medium text-gray-700 mb-1">Status Pagamento</label>
                    <select 
                      id="edit-pagamento"
                      name="pagamento"
                      value={editedPedido.pagamento || ''}
                      onChange={handleEditInputChange}
                      className="input-field"
                    >
                      {pagamentoOptions.map(option => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </div>
                </div>
                
                {/* Rodapé Fixo do Modal */}
                <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end space-x-3 rounded-b-xl">
                  <button 
                    type="button" 
                    onClick={() => setIsEditModalOpen(false)} 
                    disabled={saving}
                    className="btn-secondary"
                  >
                    <XCircle size={18} className="inline mr-1"/> Cancelar
                  </button>
                  <button 
                    type="button" 
                    onClick={handleSaveEdit} 
                    disabled={saving}
                    className="btn-primary bg-blue-600 hover:bg-blue-700"
                  >
                    {saving ? <Loader2 size={18} className="inline mr-1 animate-spin"/> : <Save size={18} className="inline mr-1"/>}
                    {saving ? 'Salvando...' : 'Salvar Alterações'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Modal de Confirmação de Exclusão - Estilo "Apple" */}
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
                  <button 
                    onClick={() => setIsDeleteModalOpen(false)} 
                    disabled={saving}
                    className="btn-secondary"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleDeletePedido} 
                    disabled={saving}
                    className="btn-danger"
                  >
                    {saving ? <Loader2 size={18} className="inline mr-1 animate-spin"/> : <Trash2 size={18} className="inline mr-1"/>}
                    {saving ? 'Removendo...' : 'Confirmar Remoção'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </> // Fechamento do Fragment <> CORRIGIDO
      )} {/* Fechamento do if (currentView === "comandas") CORRIGIDO */} 

      {/* Conteúdo da Aba Cardápio */}
      {currentView === "cardapio" && (
        <CardapioPage />
      )}

    </div> // Fechamento da div principal CORRIGIDO
  ); // Fechamento do return CORRIGIDO
} // Fechamento da função App CORRIGIDO

export default App;


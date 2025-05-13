import { useState, useEffect, useRef } from "react";
import "./App.css";
import { supabase } from "./supabaseClient";
import ComandaCard, { Pedido } from "./components/ComandaCard";
import CardapioPage from "./components/CardapioPage"; // Nova página do Cardápio
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";

const notificationSound = "/assets/sounds/notify.mp3";

type View = "comandas" | "cardapio"; // Tipo para controlar a visualização

function App() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newPedidoKeys, setNewPedidoKeys] = useState<Set<string>>(new Set());
  const audioPlayer = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [currentView, setCurrentView] = useState<View>("comandas"); // Estado para controlar a visualização atual

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
        if (!pedidos.find(p => p.telefone_key === insertedKey)) { // Evitar som duplicado se o fetch for muito rápido
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

  useEffect(() => {
    if (currentView === "comandas") {
        fetchPedidos();

        const handleChanges = (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
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
          .subscribe((status: "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR", err?: Error) => {
            if (status === "SUBSCRIBED") {
              console.log("Conectado ao canal Realtime do Supabase (Comandas)!");
            } else if (status === "CHANNEL_ERROR") {
              console.error("Erro no canal Realtime do Supabase (Comandas):", err);
              setError(`Erro de conexão em tempo real (Comandas): ${err?.message || "Erro desconhecido"}`);
            } else if (status === "TIMED_OUT") {
              console.warn("Timeout na conexão Realtime do Supabase (Comandas).");
              setError("Conexão em tempo real (Comandas) expirou. Tente atualizar manualmente.");
            } else if (status === "CLOSED"){
              console.log("Canal Realtime (Comandas) fechado.")
            }
          });

        audioPlayer.current = new Audio(notificationSound);
        audioPlayer.current.load();

        return () => {
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current).then(status => console.log("Canal Realtime (Comandas) removido, status:", status)).catch(console.error);
            channelRef.current = null;
          }
        };
    } else {
        // Lógica para quando a view for 'cardapio', se necessário desativar o canal de comandas
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current).then(status => console.log("Canal Realtime (Comandas) removido ao mudar de view, status:", status)).catch(console.error);
            channelRef.current = null;
        }
        setError(null); // Limpar erros de comandas ao mudar de view
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]); // Adicionado currentView como dependência

  const handlePedidoUpdate = () => {
    console.log("Atualização de pedido individual concluída, re-buscando todos os pedidos para manter a ordem.");
    fetchPedidos();
  };

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

      {error && <p className="text-red-600 text-center mb-6 p-4 bg-red-100 rounded-lg shadow">{error}</p>}
      
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
              />
            ))}
          </div>
        </>
      )}

      {currentView === "cardapio" && (
        <CardapioPage />
      )}

    </div>
  );
}

export default App;


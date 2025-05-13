import React, { useState } from "react";
import { supabase } from "../supabaseClient";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react"; 

export type StatusPedido = "Aguardando" | "Em preparo" | "Pronto" | "Enviado" | "Entregue";
export type StatusPagamento = "Pago" | "Aguardando pagamento";

export interface Pedido {
  comanda: string;
  telefone_key: string; 
  nome_cliente: string; 
  status_pedido: StatusPedido;
  pagamento: StatusPagamento;
  hora_criacao_pedido: string; // Adicionado para o timestamp
}

interface ComandaCardProps {
  pedido: Pedido;
  onUpdate: () => void;
  isNew?: boolean; 
}

const statusOptions: StatusPedido[] = ["Aguardando", "Em preparo", "Pronto", "Enviado", "Entregue"];
const pagamentoOptions: StatusPagamento[] = ["Aguardando pagamento", "Pago"];

// Função para formatar o timestamp para HH:MM:SS no fuso de São Paulo
const formatHoraPedido = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("pt-BR", { 
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (e) {
    console.error("Erro ao formatar hora do pedido:", e);
    return "Hora inválida";
  }
};

const FormattedComanda: React.FC<{ comandaText: string }> = ({ comandaText }) => {
  const lines = comandaText.split("\n");
  return (
    <div className="text-left text-sm">
      {lines.map((line, index) => {
        const parts = line.split(/:(.+)/);
        if (parts.length > 1) {
          return (
            <div key={index} className="mb-0.5">
              <span className="font-semibold text-gray-700">{parts[0]}:</span>
              <span className="text-gray-600">{parts[1]}</span>
            </div>
          );
        }
        return <div key={index} className="text-gray-600 mb-0.5">{line}</div>;
      })}
    </div>
  );
};

const ComandaCard: React.FC<ComandaCardProps> = ({ pedido, onUpdate, isNew }) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState<boolean | null>(null);

  const showFeedback = (success: boolean) => {
    setUpdateSuccess(success);
    setTimeout(() => setUpdateSuccess(null), 2000); 
  };

  const handleStatusChange = async (newStatus: StatusPedido) => {
    setIsUpdating(true);
    setUpdateSuccess(null);
    const { error } = await supabase
      .from("Comandas")
      .update({ status_pedido: newStatus })
      .eq("telefone_key", pedido.telefone_key);
    setIsUpdating(false);
    if (error) {
      console.error("Erro ao atualizar status do pedido:", error);
      alert(`Falha ao atualizar status do pedido: ${error.message}`);
      showFeedback(false);
    } else {
      onUpdate(); 
      showFeedback(true);
    }
  };

  const handlePagamentoChange = async (newPagamento: StatusPagamento) => {
    setIsUpdating(true);
    setUpdateSuccess(null);
    const { error } = await supabase
      .from("Comandas")
      .update({ pagamento: newPagamento })
      .eq("telefone_key", pedido.telefone_key);
    setIsUpdating(false);
    if (error) {
      console.error("Erro ao atualizar status do pagamento:", error);
      alert(`Falha ao atualizar status do pagamento: ${error.message}`);
      showFeedback(false);
    } else {
      onUpdate();
      showFeedback(true);
    }
  };

  const handleCopiarComanda = () => {
    navigator.clipboard.writeText(pedido.comanda)
      .then(() => alert("Comanda copiada para a área de transferência!"))
      .catch(err => {
        console.error("Erro ao copiar comanda:", err);
        alert("Falha ao copiar comanda.");
      });
  };

  const cardClasses = `border p-5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 bg-white group flex flex-col justify-between min-h-[450px] relative ${
    isNew ? "animate-pulse border-custom-pink border-2 ring-4 ring-custom-pink ring-opacity-50" : "border-gray-200"
  }`;

  return (
    <div className={cardClasses}>
      {isUpdating && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10 rounded-xl">
          <Loader2 className="h-8 w-8 text-custom-pink animate-spin" />
        </div>
      )}
      {updateSuccess === true && (
        <div className="absolute top-2 right-2 bg-green-100 p-1 rounded-full z-20">
          <CheckCircle className="h-5 w-5 text-green-500" />
        </div>
      )}
      {updateSuccess === false && (
        <div className="absolute top-2 right-2 bg-red-100 p-1 rounded-full z-20">
          <AlertCircle className="h-5 w-5 text-red-500" />
        </div>
      )}
      <div> 
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-xl font-bold text-gray-800">Pedido: {pedido.nome_cliente || pedido.telefone_key}</h2>
          {pedido.hora_criacao_pedido && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
              {formatHoraPedido(pedido.hora_criacao_pedido)}
            </span>
          )}
        </div>
        
        <div className="mb-4">
          <h3 className="text-md font-semibold text-gray-700 mb-1.5">Comanda Detalhada:</h3>
          <div className="text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded-md border border-gray-200 max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
            <FormattedComanda comandaText={pedido.comanda} />
          </div>
          <button 
            onClick={handleCopiarComanda}
            className="mt-2.5 text-xs bg-custom-pink text-white px-3.5 py-2 rounded-lg shadow-md hover:bg-pink-700 transition-colors focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-opacity-50"
          >
            Copiar Comanda
          </button>
        </div>

        <div className="mb-4">
          <label htmlFor={`status-${pedido.telefone_key}`} className="block text-sm font-medium text-gray-700 mb-1">Status do Pedido:</label>
          <select 
            id={`status-${pedido.telefone_key}`}
            value={pedido.status_pedido}
            onChange={(e) => handleStatusChange(e.target.value as StatusPedido)}
            className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-custom-pink focus:border-custom-pink group-hover:border-pink-400 transition-all appearance-none bg-white bg-no-repeat bg-right pr-8" 
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/\%3e%3c/svg%3e")`}}
          >
            {statusOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label htmlFor={`pagamento-${pedido.telefone_key}`} className="block text-sm font-medium text-gray-700 mb-1">Status do Pagamento:</label>
          <select 
            id={`pagamento-${pedido.telefone_key}`}
            value={pedido.pagamento}
            onChange={(e) => handlePagamentoChange(e.target.value as StatusPagamento)}
            className="w-full p-2.5 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-custom-pink focus:border-custom-pink group-hover:border-pink-400 transition-all appearance-none bg-white bg-no-repeat bg-right pr-8"
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/\%3e%3c/svg%3e")`}}
          >
            {pagamentoOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-sm text-gray-500 mt-auto pt-3 text-center border-t border-gray-200">Telefone (Chave): <span className="font-semibold text-gray-700">{pedido.telefone_key}</span></p>
    </div>
  );
};

export default ComandaCard;


import React, { useState } from "react";
import { supabase } from "../supabaseClient";
import { CheckCircle, AlertCircle, Loader2, Edit3, Trash2, Copy } from "lucide-react"; 

// Tipos exportados
export type StatusPedido = "Aguardando" | "Em preparo" | "Pronto" | "Enviado" | "Entregue";
export type StatusPagamento = "Pago" | "Aguardando pagamento";

export interface Pedido {
  comanda: string;
  telefone_key: string; 
  nome_cliente: string; 
  status_pedido: StatusPedido;
  pagamento: StatusPagamento;
  hora_criacao_pedido: string;
}

// Props do componente
interface ComandaCardProps {
  pedido: Pedido;
  onUpdate: () => void;
  isNew?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

// Opções para selects
const statusOptions: StatusPedido[] = ["Aguardando", "Em preparo", "Pronto", "Enviado", "Entregue"];
const pagamentoOptions: StatusPagamento[] = ["Aguardando pagamento", "Pago"];

// Função para formatar o timestamp
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
    return "--:--:--";
  }
};

// Componente para formatar o texto da comanda
const FormattedComanda: React.FC<{ comandaText: string }> = ({ comandaText }) => {
  const lines = comandaText.split("\n");
  return (
    <div className="text-left text-sm space-y-0.5">
      {lines.map((line, index) => {
        const parts = line.split(/:(.+)/);
        if (parts.length > 1) {
          return (
            <div key={index}>
              <span className="font-semibold text-gray-700">{parts[0]}:</span>
              <span className="text-gray-600 break-words">{parts[1]}</span>
            </div>
          );
        }
        return <div key={index} className="text-gray-600 break-words">{line}</div>;
      })}
    </div>
  );
};

// Componente principal do Card da Comanda
const ComandaCard: React.FC<ComandaCardProps> = ({ pedido, onUpdate, isNew, onEdit, onDelete }) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState<boolean | null>(null);

  // Feedback visual após atualização
  const showFeedback = (success: boolean) => {
    setUpdateSuccess(success);
    setTimeout(() => setUpdateSuccess(null), 2000); 
  };

  // Atualizar status do pedido
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

  // Atualizar status do pagamento
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

  // Copiar texto da comanda
  const handleCopiarComanda = () => {
    navigator.clipboard.writeText(pedido.comanda)
      .then(() => alert("Comanda copiada para a área de transferência!"))
      .catch(err => {
        console.error("Erro ao copiar comanda:", err);
        alert("Falha ao copiar comanda.");
      });
  };

  // Classes do card
  const cardClasses = `border border-gray-200 p-4 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200 bg-white group flex flex-col justify-between min-h-[400px] relative ${
    isNew ? "ring-2 ring-pink-300 ring-offset-2" : ""
  }`;

  return (
    <div className={cardClasses}>
      {/* Overlay de Loading */}
      {isUpdating && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10 rounded-lg">
          <Loader2 className="h-8 w-8 text-pink-500 animate-spin" />
        </div>
      )}
      {/* Feedback de Sucesso/Erro */}
      {updateSuccess === true && (
        <div className="absolute top-2 right-2 bg-green-100 p-1 rounded-full z-20">
          <CheckCircle className="h-5 w-5 text-green-600" />
        </div>
      )}
      {updateSuccess === false && (
        <div className="absolute top-2 right-2 bg-red-100 p-1 rounded-full z-20">
          <AlertCircle className="h-5 w-5 text-red-600" />
        </div>
      )}
      
      {/* Conteúdo Principal do Card */}
      <div className="flex-grow">
        {/* Cabeçalho: Nome e Hora */}
        <div className="flex justify-between items-start mb-3 pb-2 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800 break-words">
            {pedido.nome_cliente || pedido.telefone_key}
          </h2>
          {pedido.hora_criacao_pedido && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded flex-shrink-0 ml-2">
              {formatHoraPedido(pedido.hora_criacao_pedido)}
            </span>
          )}
        </div>
        
        {/* Detalhes da Comanda */}
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Comanda:</h3>
          <div className="text-gray-700 whitespace-pre-wrap bg-gray-50 p-2.5 rounded-md border border-gray-200 max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 text-justify">
            <FormattedComanda comandaText={pedido.comanda} />
          </div>
          <button 
            onClick={handleCopiarComanda}
            className="mt-2 text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded hover:bg-gray-200 transition-colors flex items-center"
          >
            <Copy size={12} className="mr-1" /> Copiar
          </button>
        </div>

        {/* Select Status Pedido */}
        <div className="mb-4">
          <label htmlFor={`status-${pedido.telefone_key}`} className="block text-sm font-medium text-gray-700 mb-1">Status Pedido:</label>
          <select 
            id={`status-${pedido.telefone_key}`}
            value={pedido.status_pedido}
            onChange={(e) => handleStatusChange(e.target.value as StatusPedido)}
            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-1 focus:ring-pink-500 focus:border-pink-500 text-sm appearance-none bg-white bg-no-repeat bg-right pr-8" 
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\\' fill=\'none\\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/\%3e%3c/svg%3e")`}}
          >
            {statusOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        {/* Select Status Pagamento */}
        <div className="mb-4">
          <label htmlFor={`pagamento-${pedido.telefone_key}`} className="block text-sm font-medium text-gray-700 mb-1">Status Pagamento:</label>
          <select 
            id={`pagamento-${pedido.telefone_key}`}
            value={pedido.pagamento}
            onChange={(e) => handlePagamentoChange(e.target.value as StatusPagamento)}
            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-1 focus:ring-pink-500 focus:border-pink-500 text-sm appearance-none bg-white bg-no-repeat bg-right pr-8"
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\\' fill=\'none\\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/\%3e%3c/svg%3e")`}}
          >
            {pagamentoOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Rodapé com Botões de Ação e Chave */}
      <div className="mt-auto pt-3 border-t border-gray-100">
        <div className="flex justify-center space-x-2 mb-2">
          {onEdit && (
            <button 
              onClick={onEdit} 
              className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded shadow-sm text-sm transition-colors flex items-center"
            >
              <Edit3 size={14} className="mr-1" /> Editar
            </button>
          )}
          {onDelete && (
            <button 
              onClick={onDelete} 
              className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded shadow-sm text-sm transition-colors flex items-center"
            >
              <Trash2 size={14} className="mr-1" /> Excluir
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 text-center">Chave: <span className="font-medium text-gray-600">{pedido.telefone_key}</span></p>
      </div>
    </div>
  );
};

export default ComandaCard;

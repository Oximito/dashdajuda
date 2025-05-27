import React, { useState } from "react";
import { supabase } from "../supabaseClient";
// **CORREÇÃO: Restaurando ícones corretos para botões de ação**
import { CheckCircle, AlertCircle, Loader2, Edit3, Trash2, Copy } from "lucide-react"; 

// Tipos exportados - Mantidos
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

// Props do componente - Mantido com onEdit e onDelete
interface ComandaCardProps {
  pedido: Pedido;
  isNew?: boolean; 
  onEdit?: () => void;
  onDelete?: () => void;
}

// Opções para selects - Mantidas
const statusOptions: StatusPedido[] = ["Aguardando", "Em preparo", "Pronto", "Enviado", "Entregue"];
const pagamentoOptions: StatusPagamento[] = ["Aguardando pagamento", "Pago"];

// Função para formatar o timestamp - Mantida
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

// Componente para formatar o texto da comanda - Mantido
const FormattedComanda: React.FC<{ comandaText: string }> = ({ comandaText }) => {
  const lines = comandaText.split("\n");
  return (
    <div className="text-left text-sm space-y-1">
      {lines.map((line, index) => {
        const parts = line.split(/:(.+)/);
        if (parts.length > 1) {
          return (
            <div key={index}>
              <span className="font-semibold text-gray-800">{parts[0]}:</span>
              <span className="text-gray-700 break-words">{parts[1]}</span>
            </div>
          );
        }
        return <div key={index} className="text-gray-700 break-words">{line}</div>;
      })}
    </div>
  );
};

// Componente principal do Card da Comanda
const ComandaCard: React.FC<ComandaCardProps> = ({ pedido, isNew, onEdit, onDelete }) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState<boolean | null>(null);
  const [copySuccess, setCopySuccess] = useState<boolean>(false);

  // Feedback visual após atualização - Mantido
  const showFeedback = (success: boolean) => {
    setUpdateSuccess(success);
    setTimeout(() => setUpdateSuccess(null), 2000);
  };

  // Atualizar status do pedido - Lógica mantida
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
      showFeedback(true);
    }
  };

  // Atualizar status do pagamento - Lógica mantida
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
      showFeedback(true);
    }
  };

  // Copiar texto da comanda - Lógica mantida
  const handleCopiarComanda = () => {
    navigator.clipboard.writeText(pedido.comanda)
      .then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 1500);
      })
      .catch(err => {
        console.error("Erro ao copiar comanda:", err);
        alert("Falha ao copiar comanda.");
      });
  };

  // **CORREÇÃO: Classes do card restauradas (sombra, transição, altura mínima)**
  const cardClasses = `border border-gray-200 p-5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 bg-white group flex flex-col justify-between min-h-[450px] relative ${
    isNew ? "ring-2 ring-pink-400 ring-offset-2 animate-pulse-fast" : ""
  }`;

  return (
    <div className={cardClasses}>
      {/* Overlay de Loading - Mantido */}
      {isUpdating && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10 rounded-xl">
          <Loader2 className="h-8 w-8 text-pink-500 animate-spin" />
        </div>
      )}
      {/* Feedback de Sucesso/Erro (Update) - Mantido */}
      {updateSuccess === true && (
        <div className="absolute top-3 right-3 bg-green-100 p-1 rounded-full z-20 shadow-sm">
          <CheckCircle className="h-5 w-5 text-green-600" />
        </div>
      )}
      {updateSuccess === false && (
        <div className="absolute top-3 right-3 bg-red-100 p-1 rounded-full z-20 shadow-sm">
          <AlertCircle className="h-5 w-5 text-red-600" />
        </div>
      )}
      
      {/* Conteúdo Principal do Card */}
      <div className="flex-grow">
        {/* Cabeçalho: Nome e Hora - Mantido */}
        <div className="flex justify-between items-start mb-3 pb-2 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800 break-words">
            {pedido.nome_cliente || pedido.telefone_key}
          </h2>
          {pedido.hora_criacao_pedido && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0 ml-2">
              {formatHoraPedido(pedido.hora_criacao_pedido)}
            </span>
          )}
        </div>
        
        {/* Detalhes da Comanda - **CORREÇÃO: Altura máxima aumentada** */}
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Comanda:</h3>
          {/* **CORREÇÃO: Aumentando max-h para melhor visualização** */}
          <div className="text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded-lg border border-gray-200 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
            <FormattedComanda comandaText={pedido.comanda} />
          </div>
          {/* **CORREÇÃO: Estilo do botão Copiar restaurado** */}
          <button 
            onClick={handleCopiarComanda}
            className={`mt-2 text-xs font-medium px-3 py-1 rounded-md transition-all duration-150 flex items-center focus:outline-none focus:ring-2 focus:ring-offset-1 ${copySuccess ? "bg-green-100 text-green-700 border border-green-200 focus:ring-green-300" : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 focus:ring-gray-300"}`}
          >
            <Copy size={12} className="mr-1.5" /> {copySuccess ? "Copiado!" : "Copiar"}
          </button>
        </div>

        {/* **CORREÇÃO: Estilo dos selects restaurado (hover rosa)** */}
        <div className="mb-4">
          <label htmlFor={`status-${pedido.telefone_key}`} className="block text-sm font-medium text-gray-700 mb-1">Status Pedido:</label>
          <select 
            id={`status-${pedido.telefone_key}`}
            value={pedido.status_pedido}
            onChange={(e) => handleStatusChange(e.target.value as StatusPedido)}
            className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm appearance-none bg-white bg-no-repeat bg-right pr-8 transition-all duration-150 hover:border-pink-400"
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/\%3e%3c/svg%3e")`}}
          >
            {statusOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div className="mb-4">
          <label htmlFor={`pagamento-${pedido.telefone_key}`} className="block text-sm font-medium text-gray-700 mb-1">Status Pagamento:</label>
          <select 
            id={`pagamento-${pedido.telefone_key}`}
            value={pedido.pagamento}
            onChange={(e) => handlePagamentoChange(e.target.value as StatusPagamento)}
            className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm appearance-none bg-white bg-no-repeat bg-right pr-8 transition-all duration-150 hover:border-pink-400"
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 20 20\'%3e%3cpath stroke=\'%236b7280\' stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'1.5\' d=\'M6 8l4 4 4-4\'/\%3e%3c/svg%3e")`}}
          >
            {pagamentoOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Rodapé com Botões de Ação e Telefone */}
      <div className="mt-auto pt-3 border-t border-gray-100">
        {/* **CORREÇÃO: Estilo dos botões Editar/Excluir restaurado** */}
        <div className="flex justify-center space-x-3 mb-3">
          {onEdit && (
            <button 
              onClick={onEdit} 
              className="btn-icon text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-1 focus:ring-blue-300 rounded-md p-1"
            >
              <Edit3 size={18} />
            </button>
          )}
          {onDelete && (
            <button 
              onClick={onDelete} 
              className="btn-icon text-red-600 hover:text-red-800 focus:outline-none focus:ring-1 focus:ring-red-300 rounded-md p-1"
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
        {/* **CORREÇÃO: Texto "Telefone" restaurado** */}
        <p className="text-xs text-gray-500 text-center">Telefone: <span className="font-medium text-gray-600">{pedido.telefone_key}</span></p>
      </div>
    </div>
  );
};

export default ComandaCard;

// **Estilos reutilizáveis (adicionar ao App.css ou similar)**
/*
.btn-icon {
  @apply p-1 rounded-md hover:bg-gray-100 transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-gray-300;
}
*/


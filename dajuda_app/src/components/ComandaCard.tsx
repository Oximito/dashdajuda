import React, { useState } from "react";
import { supabase } from "../supabaseClient";
import { CheckCircle, AlertCircle, Loader2, Edit3, Trash2, Copy } from "lucide-react"; // Adicionado Edit3, Trash2, Copy

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

// Props do componente - Removido onUpdate, adicionado onEdit, onDelete
interface ComandaCardProps {
  pedido: Pedido;
  isNew?: boolean; 
  onEdit?: () => void; // Adicionado
  onDelete?: () => void; // Adicionado
}

// Opções para selects
const statusOptions: StatusPedido[] = ["Aguardando", "Em preparo", "Pronto", "Enviado", "Entregue"];
const pagamentoOptions: StatusPagamento[] = ["Aguardando pagamento", "Pago"];

// Função para formatar o timestamp
const formatHoraPedido = (timestamp: string): string => {
  try {
    const date = new Date(timestamp);
    // Formatando para HH:MM:SS
    return date.toLocaleTimeString("pt-BR", { 
      timeZone: "America/Sao_Paulo", // Garantir fuso horário de São Paulo
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (e) {
    console.error("Erro ao formatar hora do pedido:", e);
    return "--:--:--"; // Retorno padrão em caso de erro
  }
};

// Componente para formatar o texto da comanda com melhor espaçamento
const FormattedComanda: React.FC<{ comandaText: string }> = ({ comandaText }) => {
  const lines = comandaText.split("\n");
  return (
    // Ajustado para melhor leitura e quebra de linha
    <div className="text-left text-sm space-y-1">
      {lines.map((line, index) => {
        const parts = line.split(/:(.+)/); // Divide no primeiro ':' encontrado
        if (parts.length > 1) {
          return (
            <div key={index}>
              <span className="font-semibold text-gray-800">{parts[0]}:</span>
              <span className="text-gray-700 break-words">{parts[1]}</span>
            </div>
          );
        }
        // Linhas sem ':' são renderizadas diretamente
        return <div key={index} className="text-gray-700 break-words">{line}</div>;
      })}
    </div>
  );
};

// Componente principal do Card da Comanda - Removido onUpdate dos parâmetros
const ComandaCard: React.FC<ComandaCardProps> = ({ pedido, isNew, onEdit, onDelete }) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState<boolean | null>(null);
  const [copySuccess, setCopySuccess] = useState<boolean>(false); // Estado para feedback de cópia

  // Feedback visual após atualização
  const showFeedback = (success: boolean) => {
    setUpdateSuccess(success);
    setTimeout(() => setUpdateSuccess(null), 2000); // Feedback some após 2 segundos
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
      // Não chama mais onUpdate(), o Realtime deve atualizar
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
      // Não chama mais onUpdate()
      showFeedback(true);
    }
  };

  // Copiar texto da comanda
  const handleCopiarComanda = () => {
    navigator.clipboard.writeText(pedido.comanda)
      .then(() => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 1500); // Mostra feedback por 1.5s
      })
      .catch(err => {
        console.error("Erro ao copiar comanda:", err);
        alert("Falha ao copiar comanda.");
      });
  };

  // Classes do card - Restaurando sombra sutil e transição suave
  const cardClasses = `border border-gray-200 p-4 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 bg-white group flex flex-col justify-between min-h-[480px] relative ${
    // Animação de destaque para novos pedidos
    isNew ? "ring-2 ring-pink-400 ring-offset-2 animate-pulse-fast" : ""
  }`;

  return (
    <div className={cardClasses}>
      {/* Overlay de Loading */}
      {isUpdating && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10 rounded-xl">
          <Loader2 className="h-8 w-8 text-pink-500 animate-spin" />
        </div>
      )}
      {/* Feedback de Sucesso/Erro (Update) - Posicionado no canto superior direito */}
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
        {/* Cabeçalho: Nome e Hora */}
        <div className="flex justify-between items-start mb-3 pb-2 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-800 break-words">
            {/* Usa nome do cliente, ou telefone como fallback */}
            {pedido.nome_cliente || pedido.telefone_key}
          </h2>
          {pedido.hora_criacao_pedido && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full flex-shrink-0 ml-2">
              {formatHoraPedido(pedido.hora_criacao_pedido)}
            </span>
          )}
        </div>
        
        {/* Detalhes da Comanda - Aumentando altura máxima para melhor visualização */}
        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 mb-1">Comanda:</h3>
          <div className="text-gray-700 whitespace-pre-wrap bg-gray-50 p-3 rounded-lg border border-gray-200 max-h-52 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
            <FormattedComanda comandaText={pedido.comanda} />
          </div>
          {/* Botão Copiar - Estilo minimalista "Apple" */}
          <button 
            onClick={handleCopiarComanda}
            className={`mt-2 text-xs font-medium px-3 py-1 rounded-md transition-all duration-150 flex items-center focus:outline-none focus:ring-2 focus:ring-offset-1 ${copySuccess ? "bg-green-100 text-green-700 border border-green-200 focus:ring-green-300" : "bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200 focus:ring-gray-300"}`}
          >
            <Copy size={12} className="mr-1.5" /> {copySuccess ? "Copiado!" : "Copiar"}
          </button>
        </div>

        {/* Select Status Pedido - Estilo "Apple" com hover */}
        <div className="mb-4">
          <label htmlFor={`status-${pedido.telefone_key}`} className="block text-sm font-medium text-gray-700 mb-1">Status Pedido:</label>
          <select 
            id={`status-${pedido.telefone_key}`}
            value={pedido.status_pedido}
            onChange={(e) => handleStatusChange(e.target.value as StatusPedido)}
            className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm appearance-none bg-white bg-no-repeat bg-right pr-8 transition-all duration-150 hover:border-pink-400"
            // Ícone de seta SVG inline para consistência
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`}}
          >
            {statusOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        {/* Select Status Pagamento - Estilo "Apple" com hover */}
        <div className="mb-4">
          <label htmlFor={`pagamento-${pedido.telefone_key}`} className="block text-sm font-medium text-gray-700 mb-1">Status Pagamento:</label>
          <select 
            id={`pagamento-${pedido.telefone_key}`}
            value={pedido.pagamento}
            onChange={(e) => handlePagamentoChange(e.target.value as StatusPagamento)}
            className="w-full p-2 border border-gray-300 rounded-lg shadow-sm focus:ring-2 focus:ring-pink-300 focus:border-pink-400 text-sm appearance-none bg-white bg-no-repeat bg-right pr-8 transition-all duration-150 hover:border-pink-400"
            style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`}}
          >
            {pagamentoOptions.map(option => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Rodapé com Botões de Ação e Telefone */}
      <div className="mt-auto pt-3 border-t border-gray-100">
        {/* Botões Editar/Excluir - Estilo minimalista "Apple" */}
        <div className="flex justify-center space-x-3 mb-3">
          {onEdit && (
            <button 
              onClick={onEdit} 
              className="px-4 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-lg shadow-sm text-sm font-medium transition-all duration-150 flex items-center focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-1"
            >
              <Edit3 size={14} className="mr-1.5" /> Editar
            </button>
          )}
          {onDelete && (
            <button 
              onClick={onDelete} 
              className="px-4 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg shadow-sm text-sm font-medium transition-all duration-150 flex items-center focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-1"
            >
              <Trash2 size={14} className="mr-1.5" /> Excluir
            </button>
          )}
        </div>
        {/* Mudança de "Chave" para "Telefone" */}
        <p className="text-xs text-gray-500 text-center">Telefone: <span className="font-medium text-gray-600">{pedido.telefone_key}</span></p>
      </div>
    </div>
  );
};

export default ComandaCard;


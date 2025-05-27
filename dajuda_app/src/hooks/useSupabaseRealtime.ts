import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

interface UseSupabaseRealtimeOptions {
  table: string;
  enabled: boolean;
  onInsert?: (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => void;
  onUpdate?: (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => void;
  onDelete?: (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => void;
  onChange?: (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => void;
}

export const useSupabaseRealtime = ({
  table,
  enabled,
  onInsert,
  onUpdate,
  onDelete,
  onChange
}: UseSupabaseRealtimeOptions) => {
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 2000; // 2 segundos

  const disconnect = useCallback(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
        .then(status => console.log(`Canal Realtime (${table}) removido, status:`, status))
        .catch(console.error);
      channelRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setConnectionStatus('disconnected');
  }, [table]);

  const connect = useCallback(() => {
    if (!enabled) {
      disconnect();
      return;
    }

    setConnectionStatus('connecting');
    setError(null);

    const handleChanges = (payload: RealtimePostgresChangesPayload<{[key: string]: any}>) => {
      console.log(`Mudança recebida do Supabase Realtime (${table})!`, payload);
      
      // Reset reconnect attempts on successful message
      reconnectAttemptsRef.current = 0;
      
      // Call specific handlers
      if (payload.eventType === 'INSERT' && onInsert) {
        onInsert(payload);
      } else if (payload.eventType === 'UPDATE' && onUpdate) {
        onUpdate(payload);
      } else if (payload.eventType === 'DELETE' && onDelete) {
        onDelete(payload);
      }
      
      // Call generic handler
      if (onChange) {
        onChange(payload);
      }
    };

    channelRef.current = supabase
      .channel(`${table}_realtime_channel_${Date.now()}`) // Unique channel name
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        handleChanges
      )
      .subscribe((status, err) => {
        console.log(`Canal Realtime (${table}) status:`, status, err);
        
        if (status === 'SUBSCRIBED') {
          console.log(`Conectado ao canal Realtime (${table})!`);
          setConnectionStatus('connected');
          setError(null);
          reconnectAttemptsRef.current = 0;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`Erro/Timeout no canal Realtime (${table}):`, err);
          setConnectionStatus('error');
          
          const errorMessage = err?.message || (status === 'TIMED_OUT' ? 'Timeout na conexão' : 'Erro desconhecido');
          setError(`Erro de conexão em tempo real (${table}): ${errorMessage}`);
          
          // Implement exponential backoff for reconnection
          if (reconnectAttemptsRef.current < maxReconnectAttempts) {
            const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
            console.log(`Tentando reconectar em ${delay}ms (tentativa ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
            
            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectAttemptsRef.current++;
              disconnect();
              connect();
            }, delay);
          } else {
            setError(`Falha na reconexão automática após ${maxReconnectAttempts} tentativas. Atualize a página.`);
          }
        } else if (status === 'CLOSED') {
          console.log(`Canal Realtime (${table}) fechado.`);
          setConnectionStatus('disconnected');
        }
      });
  }, [enabled, table, onInsert, onUpdate, onDelete, onChange, disconnect]);

  const forceReconnect = useCallback(() => {
    console.log(`Forçando reconexão do canal Realtime (${table})`);
    reconnectAttemptsRef.current = 0;
    disconnect();
    setTimeout(connect, 1000);
  }, [connect, disconnect, table]);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return disconnect;
  }, [enabled, connect, disconnect]);

  return {
    connectionStatus,
    error,
    forceReconnect,
    isConnected: connectionStatus === 'connected',
    isConnecting: connectionStatus === 'connecting'
  };
};

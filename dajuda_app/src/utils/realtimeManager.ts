import { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

interface RealtimeConfig {
  channel: string;
  table: string;
  onData: (payload: any) => void;
  onError?: (error: Error) => void;
  onReconnect?: () => void;
}

export class RealtimeManager {
  private channel: RealtimeChannel | null = null;
  private retryCount = 0;
  private maxRetries = 5;
  private retryDelay = 1000; // Start with 1 second
  private isDestroyed = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(
    private supabase: SupabaseClient,
    private config: RealtimeConfig
  ) {}

  async subscribe() {
    if (this.isDestroyed) return;

    try {
      // Clean up existing channel if any
      if (this.channel) {
        await this.supabase.removeChannel(this.channel);
        this.channel = null;
      }

      this.channel = this.supabase
        .channel(this.config.channel)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: this.config.table },
          (payload) => {
            this.retryCount = 0; // Reset retry count on successful message
            this.config.onData(payload);
          }
        )
        .subscribe((status, err) => {
          if (status === "SUBSCRIBED") {
            console.log(`✅ Conectado ao canal Realtime: ${this.config.channel}`);
            this.retryCount = 0;
            if (this.config.onReconnect) {
              this.config.onReconnect();
            }
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error(`❌ Erro no canal Realtime: ${this.config.channel}`, err);
            if (this.config.onError) {
              this.config.onError(err || new Error("Erro de conexão"));
            }
            this.scheduleReconnect();
          } else if (status === "CLOSED") {
            console.log(`🔒 Canal Realtime fechado: ${this.config.channel}`);
            if (!this.isDestroyed) {
              this.scheduleReconnect();
            }
          }
        });
    } catch (error) {
      console.error("Erro ao criar canal Realtime:", error);
      if (this.config.onError) {
        this.config.onError(error as Error);
      }
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.isDestroyed || this.retryCount >= this.maxRetries) {
      if (this.retryCount >= this.maxRetries) {
        console.error(`🛑 Máximo de tentativas de reconexão atingido para ${this.config.channel}`);
        if (this.config.onError) {
          this.config.onError(new Error("Máximo de tentativas de reconexão atingido"));
        }
      }
      return;
    }

    this.retryCount++;
    const delay = Math.min(this.retryDelay * Math.pow(2, this.retryCount - 1), 30000); // Max 30 seconds

    console.log(`🔄 Tentando reconectar ${this.config.channel} em ${delay}ms (tentativa ${this.retryCount}/${this.maxRetries})`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      if (!this.isDestroyed) {
        this.subscribe();
      }
    }, delay);
  }

  async destroy() {
    this.isDestroyed = true;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.channel) {
      try {
        await this.supabase.removeChannel(this.channel);
      } catch (error) {
        console.error("Erro ao remover canal:", error);
      }
      this.channel = null;
    }
  }

  resetRetryCount() {
    this.retryCount = 0;
  }
}
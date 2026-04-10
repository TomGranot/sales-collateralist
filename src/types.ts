export interface BootstrapState {
  agentId?: string;
  environmentId?: string;
  vaultId?: string;
  credentialId?: string;
}

export interface ThreadState {
  channel: string;
  threadTs: string;
  sessionId: string;
  requesterUserId: string;
  requesterName: string;
  lastCanvasId?: string;
  lastCanvasName?: string;
  updatedAt: string;
  createdAt: string;
}

export interface PersistentState {
  bootstrap: BootstrapState;
  threads: Record<string, ThreadState>;
}

export interface AgentCanvasRef {
  id: string;
  name: string;
  url?: string;
  kind?: string;
}

export interface AgentExportRef {
  title: string;
  filename: string;
  download_url: string;
  canvas_id?: string;
  canvas_name?: string;
}

export interface AgentResponsePayload {
  summary: string;
  assets?: AgentCanvasRef[];
  exports?: AgentExportRef[];
  primary_canvas?: AgentCanvasRef | null;
  follow_up?: string | null;
}

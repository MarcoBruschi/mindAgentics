use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcFrame {
    #[serde(rename = "type")]
    pub frame_type: String,
    pub id: Option<String>,
    #[serde(default)]
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRef {
    pub path: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRefsChangedPayload {
    #[serde(rename = "terminalId")]
    pub terminal_id: String,
    pub refs: Vec<AgentRef>,
}

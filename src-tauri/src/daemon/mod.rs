mod cmd_canvas_ops;
mod cmd_notes_refs;
pub mod named_pipe;
pub mod protocol;

pub use named_pipe::DaemonServer;
pub use protocol::*;

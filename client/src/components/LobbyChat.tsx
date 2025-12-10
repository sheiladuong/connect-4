import { useEffect, useState, useRef } from "react";
import { Socket } from "socket.io-client";

interface Props {
  currentUser: { id: string; username: string };
  socket: Socket;
}

interface LobbyMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  ts: string;
  system?: boolean;
}

export default function LobbyChat({ currentUser, socket }: Props) {
  const [messages, setMessages] = useState<LobbyMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // load message history for lobby
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const response = await fetch("http://localhost:3001/api/lobby-messages");
        if (response.ok) {
          const data = await response.json();
          setMessages(data);
        }
      } catch (error) {
        console.error("Error loading lobby messages:", error);
      } finally {
        setLoading(false);
      }
    };

    loadMessages();
  }, []);

  useEffect(() => {
    // listen for new messages
    const handleNewMessage = (msg: LobbyMessage) => {
      console.log("Received message:", msg);
      setMessages((prev) => {
        // check if message already exists to avoid duplicates
        if (prev.some(m => m.id === msg.id)) {
          return prev;
        }
        return [...prev, msg];
      });
    };

    socket.on("newLobbyMessage", handleNewMessage);

    return () => {
      socket.off("newLobbyMessage", handleNewMessage);
    };
  }, [socket]);

  const sendMessage = () => {
    if (!input.trim()) return;

    const messageText = input;
    
    // send to server
    socket.emit("sendLobbyMessage", { text: messageText });
    setInput("");
  };

  return (
    <div className="lobby-chat">
      <h3>Lobby Chat</h3>
      <div className="chat-messages">
        {loading ? (
          <p style={{ color: "#999", textAlign: "center", padding: "20px 0" }}>
            Loading messages...
          </p>
        ) : messages.length === 0 ? (
          <p style={{ color: "#999", textAlign: "center", padding: "20px 0" }}>
            No messages yet
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`chat-message ${m.system ? 'system-message' : ''}`}>
              <strong>{m.username}</strong>{" "}
              <span className="message-timestamp">
                {new Date(m.ts).toLocaleTimeString()}
              </span>
              <div className="message-text">{m.text}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        placeholder="Type a message..."
        className="chat-input"
      />
    </div>
  );
}
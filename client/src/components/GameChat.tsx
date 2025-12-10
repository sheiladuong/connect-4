import { useEffect, useState, useRef } from "react";
import { Socket } from "socket.io-client";

interface GameMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  ts: string;
}

interface Props {
  currentUser: { id: string; username: string };
  socket: Socket;
  gameId: string;
  opponent: { userId: string; username: string };
}

export default function GameChat({ currentUser, socket, gameId, opponent }: Props) {
  const [messages, setMessages] = useState<GameMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // load message history for this game
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const response = await fetch(`http://localhost:3001/api/game-messages/${gameId}`);
        if (response.ok) {
          const data = await response.json();
          setMessages(data);
        }
      } catch (error) {
        console.error("Error loading game messages:", error);
      } finally {
        setLoading(false);
      }
    };

    loadMessages();
  }, [gameId]);

  useEffect(() => {
    // listen for new messages
    const handleNewMessage = (msg: GameMessage) => {
      setMessages((prev) => {
        // check if message already exists to avoid duplicates
        if (prev.some(m => m.id === msg.id)) {
          return prev;
        }
        return [...prev, msg];
      });
    };

    socket.on("newGameMessage", handleNewMessage);

    return () => {
      socket.off("newGameMessage", handleNewMessage);
    };
  }, [socket]);

  const sendMessage = () => {
    if (!input.trim()) return;

    socket.emit("sendGameMessage", { gameId, text: input });
    setInput("");
  };

  return (
    <div className="game-chat">
      <h3>Chat with {opponent.username}</h3>
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
            <div 
              key={m.id} 
              className={`chat-message ${m.userId === currentUser.id ? 'own-message' : 'opponent-message'}`}
            >
              <div className="message-header">
                <strong>{m.username}</strong>
                <span className="message-timestamp">
                  {new Date(m.ts).toLocaleTimeString()}
                </span>
              </div>
              <div className="message-text">{m.text}</div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type a message..."
          className="chat-input"
          style={{ flex: 1 }}
        />
        <button
          className="game-chat-send-btn"
          onClick={sendMessage}
        >
          Send
        </button>
      </div>
    </div>
  );
}
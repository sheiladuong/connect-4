import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { socket } from "./MainLobby";
import GameChat from "./GameChat";

interface GameState {
  board: (string | null)[][];
  currentTurn: string;
  players: {
    red: { userId: string; username: string };
    yellow: { userId: string; username: string };
  };
  winner: string | null;
  winningCells: number[][] | null;
}

interface User {
  id: string;
  username: string;
}

interface Props {
  currentUser: User;
}

export default function Connect4Game({ currentUser }: Props) {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerColor, setPlayerColor] = useState<"red" | "yellow" | null>(null);
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [showForfeitModal, setShowForfeitModal] = useState(false);
  const [forfeitTimeLeft, setForfeitTimeLeft] = useState(10);
  const boardRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!gameId) return;

    socket.emit("joinGame", { gameId, userId: currentUser.id, username: currentUser.username });

    // listen for game state updates
    const handleGameState = (state: GameState) => {
      setGameState(state);
      
      // get player color
      if (state.players.red.userId === currentUser.id) {
        setPlayerColor("red");
        setIsMyTurn(state.currentTurn === "red");
      } else if (state.players.yellow.userId === currentUser.id) {
        setPlayerColor("yellow");
        setIsMyTurn(state.currentTurn === "yellow");
      }
    };

    // listen for game over
    const handleGameOver = ({ winner, winningCells }: { winner: string; winningCells: number[][] }) => {
      setGameState(prev => prev ? { ...prev, winner, winningCells } : null);
    };

    // listen for opponent forfeit
    const handleOpponentForfeited = ({ username }: { username: string }) => {
      setShowForfeitModal(true);
      setForfeitTimeLeft(10);
    };

    // listen for invalid move
    const handleInvalidMove = ({ message }: { message: string }) => {
      alert(message);
    };

    socket.on("gameState", handleGameState);
    socket.on("gameOver", handleGameOver);
    socket.on("opponentForfeited", handleOpponentForfeited);
    socket.on("invalidMove", handleInvalidMove);

    return () => {
      socket.off("gameState", handleGameState);
      socket.off("gameOver", handleGameOver);
      socket.off("opponentForfeited", handleOpponentForfeited);
      socket.off("invalidMove", handleInvalidMove);
      // leave the game room without disconnecting socket
      socket.emit("leaveRoom", { gameId });
    };
  }, [gameId, currentUser, navigate]);

  // countdown timer for forfeit modal
  useEffect(() => {
    if (showForfeitModal && forfeitTimeLeft > 0) {
      const timer = setTimeout(() => setForfeitTimeLeft(forfeitTimeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else if (showForfeitModal && forfeitTimeLeft === 0) {
      navigate("/lobby");
    }
  }, [showForfeitModal, forfeitTimeLeft, navigate]);

  const handleColumnClick = (col: number) => {
    if (!gameState || !isMyTurn || gameState.winner) return;

    socket.emit("makeMove", { gameId, col });
  };

  const handleForfeit = () => {
    if (window.confirm("Are you sure you want to forfeit?")) {
      socket.emit("forfeitGame", { gameId });
      navigate("/lobby");
    }
  };

  const handleLeaveGame = () => {
    navigate("/lobby");
  };

  if (!gameState) {
    return (
      <div style={{ textAlign: "center", padding: 50 }}>
        <h2>Loading game...</h2>
      </div>
    );
  }

  const opponent = playerColor === "red" ? gameState.players.yellow : gameState.players.red;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 30 }}>
      {/* forfeit modal */}
      {showForfeitModal && (
        <>
          <div style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "white",
            border: "3px solid #f44336",
            borderRadius: "8px",
            padding: "30px",
            boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
            zIndex: 1000,
            textAlign: "center",
            minWidth: "350px"
          }}>
            <h2 style={{ color: "#f44336", marginBottom: "20px" }}>Opponent Forfeited!</h2>
            <p style={{ fontSize: "18px", margin: "20px 0" }}>
              <strong>{opponent?.username}</strong> has forfeited the game.
            </p>
            <p style={{ fontSize: "20px", fontWeight: "bold", color: "#4caf50", marginBottom: "20px" }}>
              You Win!
            </p>
            <p style={{ fontSize: "16px", color: "#666", marginBottom: "20px" }}>
              Redirecting in {forfeitTimeLeft}s...
            </p>
            <button
              onClick={() => navigate("/lobby")}
              style={{
                padding: "12px 24px",
                backgroundColor: "#2196f3",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "16px",
                fontWeight: "bold"
              }}
            >
              Back to Lobby
            </button>
          </div>
          
          {/* overlay */}
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 999
          }} />
        </>
      )}

      {/* header */}
      <div style={{ marginBottom: 20, textAlign: "center" }}>
        <h1>Connect 4</h1>
        <div style={{ display: "flex", gap: 30, justifyContent: "center", marginTop: 10 }}>
          <div style={{ 
            padding: "10px 20px", 
            backgroundColor: playerColor === "red" ? "#ff6b6b" : "#555",
            borderRadius: 8,
            color: "white",
            fontWeight: "bold"
          }}>
            {gameState.players.red.username} {playerColor === "red" && "(You)"}
          </div>
          <div style={{ 
            padding: "10px 20px", 
            backgroundColor: playerColor === "yellow" ? "#ffd93d" : "#555",
            borderRadius: 8,
            color: playerColor === "yellow" ? "#333" : "white",
            fontWeight: "bold"
          }}>
            {gameState.players.yellow.username} {playerColor === "yellow" && "(You)"}
          </div>
        </div>
      </div>

      {/* turn indicator */}
      {!gameState.winner && (
        <div style={{ 
          padding: "15px 30px", 
          backgroundColor: isMyTurn ? "#4caf50" : "#f991cc",
          color: "white",
          borderRadius: 8,
          marginBottom: 20,
          fontSize: 18,
          fontWeight: "bold"
        }}>
          {isMyTurn ? "Your Turn!" : `${opponent.username}'s Turn`}
        </div>
      )}

      {/* winner display */}
      {gameState.winner && (
        <div style={{ 
          padding: "20px 40px", 
          backgroundColor: gameState.winner === "draw" ? "#f991cc" : (gameState.winner === playerColor ? "#4caf50" : "#f44336"),
          color: "white",
          borderRadius: 8,
          marginBottom: 20,
          fontSize: 24,
          fontWeight: "bold"
        }}>
          {gameState.winner === "draw" ? "It's a Draw!" : (gameState.winner === playerColor ? "You Won!" : `${opponent.username} Won!`)}
        </div>
      )}

      <div style={{ display: "flex", gap: 30 }}>
        {/* game board in SVG */}
        <div>
          <svg 
            ref={boardRef}
            width="490"
            height="420"
            viewBox="0 0 490 420"
            style={{ 
              backgroundColor: "#2196f3",
              borderRadius: 12,
              boxShadow: "0 4px 8px rgba(0,0,0,0.3)"
            }}
          >
            {/* board background */}
            <rect width="490" height="420" fill="#2196f3" rx="12" />
            
            {/* draw cells */}
            {gameState.board.map((row, rowIndex) => (
              row.map((cell, colIndex) => {
                const isWinningCell = gameState.winningCells?.some(
                  ([r, c]) => r === rowIndex && c === colIndex
                );
                const cx = colIndex * 70 + 35;
                const cy = rowIndex * 70 + 35;
                const isHovered = hoveredCol === colIndex && isMyTurn && !gameState.winner;
                
                return (
                  <g key={`${rowIndex}-${colIndex}`}>
                    {/* cell circle */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r="28"
                      fill={cell === "red" ? "#ff6b6b" : cell === "yellow" ? "#ffd93d" : "#e0e0e0"}
                      stroke={isWinningCell ? "#4caf50" : "none"}
                      strokeWidth={isWinningCell ? "4" : "0"}
                      opacity={isHovered ? 0.7 : 1}
                      style={{ 
                        cursor: isMyTurn && !gameState.winner ? "pointer" : "default",
                        transition: "all 0.3s",
                        filter: isWinningCell ? "drop-shadow(0 0 8px #4caf50)" : "none"
                      }}
                      onClick={() => handleColumnClick(colIndex)}
                      onMouseEnter={() => setHoveredCol(colIndex)}
                      onMouseLeave={() => setHoveredCol(null)}
                    />
                    {/* inner shadow effect for empty cells */}
                    {!cell && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r="28"
                        fill="url(#innerShadow)"
                        pointerEvents="none"
                      />
                    )}
                  </g>
                );
              })
            ))}
            
            {/* gradient for inner shadow effect */}
            <defs>
              <radialGradient id="innerShadow">
                <stop offset="70%" stopColor="rgba(0,0,0,0)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.2)" />
              </radialGradient>
            </defs>
          </svg>

          {/* action buttons */}
          <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "center" }}>
            {!gameState.winner ? (
              <button
                onClick={handleForfeit}
                style={{
                  padding: "12px 24px",
                  backgroundColor: "#f44336",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 16,
                  fontWeight: "bold"
                }}
              >
                Forfeit Game
              </button>
            ) : (
              <button
                onClick={handleLeaveGame}
                style={{
                  padding: "12px 24px",
                  backgroundColor: "#2196f3",
                  color: "white",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 16,
                  fontWeight: "bold"
                }}
              >
                Back to Lobby
              </button>
            )}
          </div>
        </div>

        {/* game chat */}
        <GameChat 
          currentUser={currentUser} 
          socket={socket} 
          gameId={gameId!}
          opponent={opponent}
        />
      </div>
    </div>
  );
}
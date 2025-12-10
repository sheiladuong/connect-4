import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import LobbyChat from "./LobbyChat";
import { io, Socket } from "socket.io-client";

interface User {
  id: string;
  username: string;
}

interface OnlineUser {
  socketId: string;
  username: string;
}

interface ChallengeRequest {
  from: string;
  fromUsername: string;
  to: string;
  challengeId: string;
}

interface Props {
  currentUser: User;
  onLogout: () => void;
}

// create socket outside component to persist across navigation
const socket: Socket = io("http://localhost:3001", {
  autoConnect: false
});

export default function MainLobby({ currentUser, onLogout }: Props) {
  const navigate = useNavigate();
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [incomingChallenge, setIncomingChallenge] = useState<ChallengeRequest | null>(null);
  const [timeLeft, setTimeLeft] = useState(10);
  const [challengingSomeone, setChallengingSomeone] = useState(false);

  useEffect(() => {
    // connect socket if not connected
    if (!socket.connected) {
      socket.connect();
    }

    const hasJoined = socket.hasListeners("onlineUsers");
    
    if (!hasJoined) {
      // join lobby with user info
      socket.emit("joinLobby", { 
        userId: currentUser.id,
        username: currentUser.username 
      });
    }

    // listen for online users updates
    const handleOnlineUsers = (users: OnlineUser[]) => {
      setOnlineUsers(users);
    };

    // listen for incoming challenge
    const handleChallengeReceived = (challenge: ChallengeRequest) => {
      setIncomingChallenge(challenge);
      setTimeLeft(10);
    };

    // listen for challenge acceptance
    const handleChallengeAccepted = ({ gameId }: { gameId: string }) => {
      navigate(`/game/${gameId}`);
    };

    // listen for challenge declined
    const handleChallengeDeclined = ({ username }: { username: string }) => {
      alert(`${username} declined your challenge`);
      setChallengingSomeone(false);
    };

    // listen for challenge timeout
    const handleChallengeTimeout = () => {
      alert("Challenge timed out");
      setIncomingChallenge(null);
      setChallengingSomeone(false);
    };

    socket.on("onlineUsers", handleOnlineUsers);
    socket.on("challengeReceived", handleChallengeReceived);
    socket.on("challengeAccepted", handleChallengeAccepted);
    socket.on("challengeDeclined", handleChallengeDeclined);
    socket.on("challengeTimeout", handleChallengeTimeout);

    return () => {
      socket.off("onlineUsers", handleOnlineUsers);
      socket.off("challengeReceived", handleChallengeReceived);
      socket.off("challengeAccepted", handleChallengeAccepted);
      socket.off("challengeDeclined", handleChallengeDeclined);
      socket.off("challengeTimeout", handleChallengeTimeout);
    };
  }, [currentUser, navigate]);

  // countdown timer for incoming challenge
  useEffect(() => {
    if (incomingChallenge && timeLeft > 0) {
      const timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
      return () => clearTimeout(timer);
    } else if (incomingChallenge && timeLeft === 0) {
      handleDeclineChallenge();
    }
  }, [incomingChallenge, timeLeft]);

  const handleLogout = () => {
    socket.disconnect();
    onLogout();
    navigate("/login");
  };

  const handleChallenge = (opponent: OnlineUser) => {
    if (opponent.username === currentUser.username) {
      alert("You can't challenge yourself!");
      return;
    }
    setChallengingSomeone(true);
    socket.emit("sendChallenge", {
      to: opponent.socketId,
      toUsername: opponent.username
    });
  };

  const handleAcceptChallenge = () => {
    if (incomingChallenge) {
      socket.emit("acceptChallenge", {
        challengeId: incomingChallenge.challengeId,
        from: incomingChallenge.from
      });
      setIncomingChallenge(null);
    }
  };

  const handleDeclineChallenge = () => {
    if (incomingChallenge) {
      socket.emit("declineChallenge", {
        challengeId: incomingChallenge.challengeId,
        from: incomingChallenge.from
      });
      setIncomingChallenge(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 50 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", maxWidth: 900, marginBottom: 20 }}>
        <h1>Welcome, {currentUser.username}!</h1>
        <button 
          className="logout-button"
          onClick={handleLogout}
        >
          Logout
        </button>
      </div>

      {/* challenge notification */}
      {incomingChallenge && (
        <div style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          backgroundColor: "white",
          border: "3px solid #007bff",
          borderRadius: "8px",
          padding: "30px",
          boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
          zIndex: 1000,
          textAlign: "center",
          minWidth: "300px"
        }}>
          <h2>Challenge Received!</h2>
          <p style={{ fontSize: "18px", margin: "20px 0" }}>
            <strong>{incomingChallenge.fromUsername}</strong> wants to play Connect 4
          </p>
          <p style={{ fontSize: "24px", fontWeight: "bold", color: timeLeft <= 3 ? "#dc3545" : "#007bff" }}>
            {timeLeft}s
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
            <button
              onClick={handleAcceptChallenge}
              style={{
                padding: "12px 24px",
                backgroundColor: "#28a745",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "16px",
                fontWeight: "bold"
              }}
            >
              Accept
            </button>
            <button
              onClick={handleDeclineChallenge}
              style={{
                padding: "12px 24px",
                backgroundColor: "#dc3545",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "16px",
                fontWeight: "bold"
              }}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* overlay when challenge is active */}
      {incomingChallenge && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(0,0,0,0.5)",
          zIndex: 999
        }} />
      )}

      <div style={{ display: "flex", gap: 20 }}>
        {/* online users with challenge buttons */}
        <div className="online-users-box">
          <h3>Online Users ({onlineUsers.length})</h3>
          <div>
            {onlineUsers.map((user) => (
              <div 
                key={user.socketId} 
                className={`user-item ${user.username === currentUser.username ? 'current-user' : ''}`}
              >
                <span>
                  {user.username}
                  {user.username === currentUser.username && " (You)"}
                </span>
                {user.username !== currentUser.username && (
                  <button
                    onClick={() => handleChallenge(user)}
                    disabled={challengingSomeone}
                    className="challenge-button"
                  >
                    Challenge
                  </button>
                )}
              </div>
            ))}
            {onlineUsers.length === 0 && (
              <p style={{ color: "#999", textAlign: "center" }}>No users online</p>
            )}
          </div>
        </div>

        {/* lobby chat */}
        <LobbyChat currentUser={currentUser} socket={socket} />
      </div>

      {challengingSomeone && (
        <div style={{ 
          marginTop: 20, 
          padding: 10, 
          backgroundColor: "#ffdafc", 
          border: "1px solid #f991cc",
          borderRadius: "4px"
        }}>
          Waiting for opponent to respond...
        </div>
      )}
    </div>
  );
}

export { socket };
// server.js - Backend Node.js com WebSocket
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;

// Clash Royale cards
const CLASH_ROYALE_CARDS = [
  'Knight', 'Archers', 'Goblins', 'Giant', 'P.E.K.K.A', 'Minions', 'Balloon',
  'Witch', 'Barbarians', 'Golem', 'Skeleton Army', 'Valkyrie', 'Skeleton',
  'Mini P.E.K.K.A', 'Musketeer', 'Baby Dragon', 'Prince', 'Wizard', 'Hog Rider',
  'Freeze', 'Rage', 'Mirror', 'Lightning', 'Zap', 'Fireball', 'Arrows',
  'Goblin Barrel', 'Rocket', 'Tombstone', 'Bomb Tower', 'Tesla', 'Elixir Collector',
  'X-Bow', 'Inferno Tower', 'Cannon', 'Miner', 'Lava Hound', 'Ice Wizard',
  'Princess', 'Sparky', 'Lumberjack', 'Electro Wizard', 'Mega Knight'
];

// Game state
let gameState = {
  hintsPerPlayer: 2,
  players: [],
  phase: 'lobby',
  selectedCard: null,
  impostorId: null,
  currentHintPlayer: 0,
  hintsGiven: [],
  votes: {},
  playerOrder: [],
  gameStarted: false
};

// Create HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Find the Impostor WebSocket Server');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Broadcast to all clients
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// Calculate vote results
function getVoteResults() {
  const voteCounts = {};
  Object.values(gameState.votes).forEach(suspectId => {
    voteCounts[suspectId] = (voteCounts[suspectId] || 0) + 1;
  });

  let mostVoted = null;
  let maxVotes = 0;
  Object.entries(voteCounts).forEach(([playerId, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      mostVoted = playerId;
    }
  });

  const impostorCaught = mostVoted === gameState.impostorId;

  return {
    impostorId: gameState.impostorId,
    mostVotedId: mostVoted,
    impostorCaught,
    voteCounts,
    selectedCard: gameState.selectedCard
  };
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('New client connected. Total clients:', wss.clients.size);

  // Send current state to new client
  ws.send(JSON.stringify({
    type: 'STATE_UPDATE',
    game: gameState
  }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received:', data.type);

      switch (data.type) {
        case 'GET_STATE':
          ws.send(JSON.stringify({
            type: 'STATE_UPDATE',
            game: gameState
          }));
          break;

        case 'JOIN':
          // Check if player already exists
          const existingPlayer = gameState.players.find(p => p.id === data.playerId);
          if (!existingPlayer) {
            gameState.players.push({
              id: data.playerId,
              name: data.playerName
            });
            console.log(`Player joined: ${data.playerName}`);
          }
          broadcast({
            type: 'STATE_UPDATE',
            game: gameState
          });
          break;

        case 'UPDATE_HINTS':
          if (gameState.phase === 'lobby' && !gameState.gameStarted) {
            gameState.hintsPerPlayer = data.hintsPerPlayer;
            broadcast({
              type: 'STATE_UPDATE',
              game: gameState
            });
          }
          break;

        case 'START_GAME':
          if (gameState.players.length >= 3 && !gameState.gameStarted) {
            // Select random card and impostor
            gameState.selectedCard = CLASH_ROYALE_CARDS[Math.floor(Math.random() * CLASH_ROYALE_CARDS.length)];
            gameState.impostorId = gameState.players[Math.floor(Math.random() * gameState.players.length)].id;
            
            // Randomize player order
            gameState.playerOrder = [...gameState.players]
              .sort(() => Math.random() - 0.5)
              .map(p => p.id);
            
            gameState.currentHintPlayer = 0;
            gameState.phase = 'hints';
            gameState.hintsGiven = gameState.players.map(p => ({
              playerId: p.id,
              hints: []
            }));
            gameState.gameStarted = true;

            console.log('Game started!');
            console.log('Card:', gameState.selectedCard);
            console.log('Impostor:', gameState.players.find(p => p.id === gameState.impostorId)?.name);

            broadcast({
              type: 'STATE_UPDATE',
              game: gameState
            });
          }
          break;

        case 'SUBMIT_HINT':
          if (gameState.phase === 'hints') {
            const playerHints = gameState.hintsGiven.find(h => h.playerId === data.playerId);
            if (playerHints && playerHints.hints.length < gameState.hintsPerPlayer) {
              playerHints.hints.push(data.hint);

              // Check if all players have given all hints
              const allHintsComplete = gameState.hintsGiven.every(h => 
                h.hints.length >= gameState.hintsPerPlayer
              );

              if (allHintsComplete) {
                gameState.phase = 'voting';
                console.log('All hints given, moving to voting');
              } else {
                // Move to next player
                gameState.currentHintPlayer = (gameState.currentHintPlayer + 1) % gameState.players.length;
              }

              broadcast({
                type: 'STATE_UPDATE',
                game: gameState
              });
            }
          }
          break;

        case 'SUBMIT_VOTE':
          if (gameState.phase === 'voting') {
            gameState.votes[data.playerId] = data.suspectId;

            // Check if all players voted
            const allVoted = Object.keys(gameState.votes).length === gameState.players.length;

            if (allVoted) {
              gameState.phase = 'results';
              const voteResults = getVoteResults();
              
              console.log('Voting complete!');
              console.log('Results:', voteResults);

              broadcast({
                type: 'STATE_UPDATE',
                game: gameState,
                voteResults
              });
            } else {
              broadcast({
                type: 'STATE_UPDATE',
                game: gameState
              });
            }
          }
          break;

        case 'RESTART_GAME':
          gameState.phase = 'lobby';
          gameState.selectedCard = null;
          gameState.impostorId = null;
          gameState.currentHintPlayer = 0;
          gameState.hintsGiven = [];
          gameState.votes = {};
          gameState.playerOrder = [];
          gameState.gameStarted = false;

          console.log('Game restarted');

          broadcast({
            type: 'STATE_UPDATE',
            game: gameState
          });
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Error processing your request'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected. Total clients:', wss.clients.size);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket server is ready!`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  wss.close(() => {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});
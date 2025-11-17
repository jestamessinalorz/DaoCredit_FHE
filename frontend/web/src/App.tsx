import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ContributionData {
  id: string;
  name: string;
  encryptedScore: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
  category: string;
}

interface UserStats {
  totalContributions: number;
  verifiedCount: number;
  avgScore: number;
  rank: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [contributions, setContributions] = useState<ContributionData[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingContribution, setCreatingContribution] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newContribution, setNewContribution] = useState({ 
    name: "", 
    score: "", 
    category: "development",
    description: "" 
  });
  const [selectedContribution, setSelectedContribution] = useState<ContributionData | null>(null);
  const [userStats, setUserStats] = useState<UserStats>({ 
    totalContributions: 0, 
    verifiedCount: 0, 
    avgScore: 0, 
    rank: 0 
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [history, setHistory] = useState<string[]>([]);
  const [leaderboard, setLeaderboard] = useState<{address: string, score: number}[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (isConnected && !isInitialized) {
        try {
          await initialize();
        } catch (error) {
          console.error('FHEVM init failed:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        
        await contract.isAvailable();
        
        const businessIds = await contract.getAllBusinessIds();
        const contributionsList: ContributionData[] = [];
        
        for (const businessId of businessIds) {
          try {
            const businessData = await contract.getBusinessData(businessId);
            contributionsList.push({
              id: businessId,
              name: businessData.name,
              encryptedScore: businessId,
              publicValue1: Number(businessData.publicValue1) || 0,
              publicValue2: Number(businessData.publicValue2) || 0,
              description: businessData.description,
              creator: businessData.creator,
              timestamp: Number(businessData.timestamp),
              isVerified: businessData.isVerified,
              decryptedValue: Number(businessData.decryptedValue) || 0,
              category: Number(businessData.publicValue2) === 1 ? "development" : 
                       Number(businessData.publicValue2) === 2 ? "governance" : "community"
            });
          } catch (e) {
            console.error('Error loading data:', e);
          }
        }
        
        setContributions(contributionsList);
        calculateStats(contributionsList);
        generateLeaderboard(contributionsList);
      } catch (e) {
        console.error('Load data error:', e);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  const calculateStats = (data: ContributionData[]) => {
    const userContributions = data.filter(c => c.creator.toLowerCase() === address?.toLowerCase());
    const verified = userContributions.filter(c => c.isVerified);
    const avg = verified.length > 0 ? 
      verified.reduce((sum, c) => sum + c.decryptedValue, 0) / verified.length : 0;
    
    setUserStats({
      totalContributions: userContributions.length,
      verifiedCount: verified.length,
      avgScore: avg,
      rank: Math.floor(Math.random() * 50) + 1
    });
  };

  const generateLeaderboard = (data: ContributionData[]) => {
    const scoreMap = new Map<string, number>();
    
    data.forEach(contribution => {
      if (contribution.isVerified) {
        const current = scoreMap.get(contribution.creator) || 0;
        scoreMap.set(contribution.creator, current + contribution.decryptedValue);
      }
    });
    
    const leaderboardData = Array.from(scoreMap.entries())
      .map(([address, score]) => ({ address, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    
    setLeaderboard(leaderboardData);
  };

  const createContribution = async () => {
    if (!isConnected || !address) { 
      showTransactionStatus("error", "Please connect wallet first");
      return; 
    }
    
    setCreatingContribution(true);
    showTransactionStatus("pending", "Encrypting contribution with FHE...");
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const scoreValue = parseInt(newContribution.score) || 0;
      const businessId = `contribution-${Date.now()}`;
      const categoryValue = newContribution.category === "development" ? 1 : 
                           newContribution.category === "governance" ? 2 : 3;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newContribution.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        categoryValue,
        newContribution.description
      );
      
      showTransactionStatus("pending", "Waiting for transaction...");
      await tx.wait();
      
      addToHistory(`Created contribution: ${newContribution.name}`);
      showTransactionStatus("success", "Contribution created successfully!");
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewContribution({ name: "", score: "", category: "development", description: "" });
        window.location.reload();
      }, 2000);
      
    } catch (e: any) {
      const errorMsg = e.message?.includes("rejected") ? "Transaction rejected" : "Creation failed";
      showTransactionStatus("error", errorMsg);
    } finally { 
      setCreatingContribution(false); 
    }
  };

  const decryptContribution = async (contributionId: string) => {
    if (!isConnected || !address) { 
      showTransactionStatus("error", "Please connect wallet first");
      return null; 
    }
    
    showTransactionStatus("pending", "Decrypting with FHE...");
    
    try {
      const contractRead = await getContractReadOnly();
      const contractWrite = await getContractWithSigner();
      if (!contractRead || !contractWrite) return null;
      
      const businessData = await contractRead.getBusinessData(contributionId);
      if (businessData.isVerified) {
        showTransactionStatus("success", "Data already verified");
        return Number(businessData.decryptedValue);
      }
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(contributionId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(contributionId, abiEncodedClearValues, decryptionProof)
      );
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      addToHistory(`Decrypted contribution: ${selectedContribution?.name}`);
      showTransactionStatus("success", "Data decrypted successfully!");
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("already verified")) {
        showTransactionStatus("success", "Data already verified");
        return null;
      }
      showTransactionStatus("error", "Decryption failed");
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (contract) {
        await contract.isAvailable();
        showTransactionStatus("success", "FHE system is available");
      }
    } catch (e) {
      showTransactionStatus("error", "Availability check failed");
    }
  };

  const addToHistory = (action: string) => {
    setHistory(prev => [`${new Date().toLocaleTimeString()}: ${action}`, ...prev.slice(0, 9)]);
  };

  const showTransactionStatus = (status: "pending" | "success" | "error", message: string) => {
    setTransactionStatus({ visible: true, status, message });
    setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
  };

  const filteredContributions = contributions.filter(contribution => {
    const matchesSearch = contribution.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         contribution.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === "all" || contribution.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = [
    { id: "all", name: "All Categories", count: contributions.length },
    { id: "development", name: "Development", count: contributions.filter(c => c.category === "development").length },
    { id: "governance", name: "Governance", count: contributions.filter(c => c.category === "governance").length },
    { id: "community", name: "Community", count: contributions.filter(c => c.category === "community").length }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🔐</div>
            <h1>DaoCredit FHE</h1>
            <span className="tagline">Private Social Credit for DAO</span>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-screen">
          <div className="welcome-panel">
            <h2>Welcome to DaoCredit</h2>
            <p>Encrypted contribution tracking with fully homomorphic encryption</p>
            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">🔒</div>
                <h3>Encrypted Data</h3>
                <p>All contributions encrypted with Zama FHE</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">⚡</div>
                <h3>Homomorphic Computing</h3>
                <p>Compute on encrypted data without decryption</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🏆</div>
                <h3>Privacy-Preserving Ranking</h3>
                <p>Fair governance with encrypted scoring</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <div className="logo-section">
            <div className="logo-icon">🏅</div>
            <div>
              <h1>DaoCredit</h1>
              <span className="tagline">FHE Encrypted Contributions</span>
            </div>
          </div>
          
          <nav className="main-nav">
            <button className="nav-item active">Dashboard</button>
            <button className="nav-item">Contributions</button>
            <button className="nav-item">Leaderboard</button>
            <button className="nav-item">Settings</button>
          </nav>
        </div>
        
        <div className="header-right">
          <button className="fhe-test-btn" onClick={checkAvailability}>
            Test FHE
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card bronze">
            <div className="stat-icon">📊</div>
            <div className="stat-content">
              <h3>Total Contributions</h3>
              <div className="stat-value">{userStats.totalContributions}</div>
            </div>
          </div>
          
          <div className="stat-card silver">
            <div className="stat-icon">✅</div>
            <div className="stat-content">
              <h3>Verified</h3>
              <div className="stat-value">{userStats.verifiedCount}</div>
            </div>
          </div>
          
          <div className="stat-card gold">
            <div className="stat-icon">⭐</div>
            <div className="stat-content">
              <h3>Average Score</h3>
              <div className="stat-value">{userStats.avgScore.toFixed(1)}</div>
            </div>
          </div>
          
          <div className="stat-card platinum">
            <div className="stat-icon">🏆</div>
            <div className="stat-content">
              <h3>DAO Rank</h3>
              <div className="stat-value">#{userStats.rank}</div>
            </div>
          </div>
        </div>

        <div className="content-grid">
          <div className="contributions-section">
            <div className="section-header">
              <h2>DAO Contributions</h2>
              <div className="header-actions">
                <div className="search-box">
                  <input 
                    type="text" 
                    placeholder="Search contributions..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <button 
                  className="create-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  + New Contribution
                </button>
              </div>
            </div>
            
            <div className="category-filters">
              {categories.map(category => (
                <button
                  key={category.id}
                  className={`category-filter ${activeCategory === category.id ? 'active' : ''}`}
                  onClick={() => setActiveCategory(category.id)}
                >
                  {category.name} ({category.count})
                </button>
              ))}
            </div>
            
            <div className="contributions-list">
              {filteredContributions.map((contribution, index) => (
                <div 
                  key={contribution.id}
                  className={`contribution-item ${contribution.isVerified ? 'verified' : 'pending'}`}
                  onClick={() => setSelectedContribution(contribution)}
                >
                  <div className="contribution-header">
                    <h3>{contribution.name}</h3>
                    <span className={`status-badge ${contribution.isVerified ? 'verified' : 'pending'}`}>
                      {contribution.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </span>
                  </div>
                  <p className="contribution-desc">{contribution.description}</p>
                  <div className="contribution-meta">
                    <span className="category-tag">{contribution.category}</span>
                    <span className="creator">{contribution.creator.substring(0, 8)}...</span>
                    <span className="timestamp">
                      {new Date(contribution.timestamp * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  {contribution.isVerified && (
                    <div className="score-display">
                      <span className="score-label">FHE Score:</span>
                      <span className="score-value">{contribution.decryptedValue}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          <div className="sidebar">
            <div className="leaderboard-panel">
              <h3>🏆 Contributor Rankings</h3>
              <div className="leaderboard-list">
                {leaderboard.map((item, index) => (
                  <div key={item.address} className="leaderboard-item">
                    <span className="rank">#{index + 1}</span>
                    <span className="address">{item.address.substring(0, 6)}...{item.address.substring(38)}</span>
                    <span className="score">{item.score} pts</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="history-panel">
              <h3>📜 Recent Activity</h3>
              <div className="history-list">
                {history.map((item, index) => (
                  <div key={index} className="history-item">
                    {item}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="fhe-info-panel">
              <h3>🔐 FHE Process</h3>
              <div className="process-steps">
                <div className="process-step">
                  <span className="step-number">1</span>
                  <span>Encrypt contribution data</span>
                </div>
                <div className="process-step">
                  <span className="step-number">2</span>
                  <span>Store encrypted on-chain</span>
                </div>
                <div className="process-step">
                  <span className="step-number">3</span>
                  <span>Homomorphic computation</span>
                </div>
                <div className="process-step">
                  <span className="step-number">4</span>
                  <span>Zero-knowledge verification</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Add New Contribution</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Contribution Name</label>
                <input 
                  type="text" 
                  value={newContribution.name}
                  onChange={(e) => setNewContribution({...newContribution, name: e.target.value})}
                  placeholder="Describe your contribution..."
                />
              </div>
              
              <div className="form-group">
                <label>FHE Encrypted Score (Integer)</label>
                <input 
                  type="number" 
                  value={newContribution.score}
                  onChange={(e) => setNewContribution({...newContribution, score: e.target.value})}
                  placeholder="Enter score (will be encrypted)..."
                />
                <div className="input-hint">This value will be encrypted with FHE</div>
              </div>
              
              <div className="form-group">
                <label>Category</label>
                <select 
                  value={newContribution.category}
                  onChange={(e) => setNewContribution({...newContribution, category: e.target.value})}
                >
                  <option value="development">Development</option>
                  <option value="governance">Governance</option>
                  <option value="community">Community</option>
                </select>
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={newContribution.description}
                  onChange={(e) => setNewContribution({...newContribution, description: e.target.value})}
                  placeholder="Detailed description of your contribution..."
                  rows={3}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createContribution}
                disabled={creatingContribution || isEncrypting}
                className="submit-btn"
              >
                {creatingContribution ? "Encrypting..." : "Create Contribution"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedContribution && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Contribution Details</h2>
              <button onClick={() => setSelectedContribution(null)} className="close-btn">×</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <label>Name</label>
                  <span>{selectedContribution.name}</span>
                </div>
                <div className="detail-item">
                  <label>Category</label>
                  <span className="category-tag">{selectedContribution.category}</span>
                </div>
                <div className="detail-item">
                  <label>Creator</label>
                  <span>{selectedContribution.creator}</span>
                </div>
                <div className="detail-item">
                  <label>Date</label>
                  <span>{new Date(selectedContribution.timestamp * 1000).toLocaleString()}</span>
                </div>
                <div className="detail-item full-width">
                  <label>Description</label>
                  <p>{selectedContribution.description}</p>
                </div>
                
                <div className="score-section">
                  <label>FHE Encrypted Score</label>
                  <div className="score-display-large">
                    {selectedContribution.isVerified ? (
                      <div className="verified-score">
                        <span className="score-value">{selectedContribution.decryptedValue}</span>
                        <span className="score-label">Decrypted Score</span>
                      </div>
                    ) : (
                      <div className="encrypted-score">
                        <span className="score-value">🔒</span>
                        <span className="score-label">Encrypted (FHE Protected)</span>
                      </div>
                    )}
                  </div>
                  
                  {!selectedContribution.isVerified && (
                    <button 
                      className="decrypt-btn"
                      onClick={() => decryptContribution(selectedContribution.id)}
                    >
                      Decrypt with FHE
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <span className="notification-icon">
              {transactionStatus.status === "pending" && "⏳"}
              {transactionStatus.status === "success" && "✅"}
              {transactionStatus.status === "error" && "❌"}
            </span>
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;



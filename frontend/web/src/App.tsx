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
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [contributions, setContributions] = useState<ContributionData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingContribution, setCreatingContribution] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newContributionData, setNewContributionData] = useState({ 
    name: "", 
    score: "", 
    description: "",
    publicValue: "" 
  });
  const [selectedContribution, setSelectedContribution] = useState<ContributionData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
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
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setContributions(contributionsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createContribution = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingContribution(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating contribution with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const scoreValue = parseInt(newContributionData.score) || 0;
      const businessId = `contribution-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newContributionData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newContributionData.publicValue) || 0,
        0,
        newContributionData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Contribution created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewContributionData({ name: "", score: "", description: "", publicValue: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingContribution(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and ready!" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredContributions = contributions.filter(contribution =>
    contribution.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contribution.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalPages = Math.ceil(filteredContributions.length / itemsPerPage);
  const paginatedContributions = filteredContributions.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>DAO Credit FHE 🌟</h1>
            <p>Private Social Credit for DAO</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access the private DAO contribution system.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted contribution system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>DAO Credit FHE 🌟</h1>
          <p>Private Social Credit for DAO</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check Availability
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Contribution
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <div className="stats-grid">
            <div className="stat-card">
              <h3>Total Contributions</h3>
              <div className="stat-value">{contributions.length}</div>
            </div>
            <div className="stat-card">
              <h3>Verified Data</h3>
              <div className="stat-value">{contributions.filter(c => c.isVerified).length}</div>
            </div>
            <div className="stat-card">
              <h3>Active Members</h3>
              <div className="stat-value">{new Set(contributions.map(c => c.creator)).size}</div>
            </div>
          </div>
        </div>

        <div className="contributions-section">
          <div className="section-header">
            <h2>DAO Contributions</h2>
            <div className="controls">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search contributions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="contributions-list">
            {paginatedContributions.length === 0 ? (
              <div className="no-contributions">
                <p>No contributions found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Contribution
                </button>
              </div>
            ) : (
              paginatedContributions.map((contribution, index) => (
                <div 
                  className={`contribution-item ${contribution.isVerified ? "verified" : ""}`}
                  key={index}
                  onClick={() => setSelectedContribution(contribution)}
                >
                  <div className="contribution-header">
                    <h3>{contribution.name}</h3>
                    <span className={`status ${contribution.isVerified ? "verified" : "pending"}`}>
                      {contribution.isVerified ? "✅ Verified" : "🔓 Pending"}
                    </span>
                  </div>
                  <p className="description">{contribution.description}</p>
                  <div className="contribution-meta">
                    <span>Public Score: {contribution.publicValue1}</span>
                    <span>By: {contribution.creator.substring(0, 6)}...{contribution.creator.substring(38)}</span>
                    <span>{new Date(contribution.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New DAO Contribution</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Contribution Name *</label>
                <input 
                  type="text" 
                  value={newContributionData.name}
                  onChange={(e) => setNewContributionData({...newContributionData, name: e.target.value})}
                  placeholder="Enter contribution name..."
                />
              </div>
              
              <div className="form-group">
                <label>Credit Score (Integer only) *</label>
                <input 
                  type="number" 
                  value={newContributionData.score}
                  onChange={(e) => setNewContributionData({...newContributionData, score: e.target.value})}
                  placeholder="Enter credit score..."
                  step="1"
                  min="0"
                />
                <div className="help-text">FHE Encrypted Integer</div>
              </div>
              
              <div className="form-group">
                <label>Public Value *</label>
                <input 
                  type="number" 
                  value={newContributionData.publicValue}
                  onChange={(e) => setNewContributionData({...newContributionData, publicValue: e.target.value})}
                  placeholder="Enter public value..."
                />
                <div className="help-text">Public Data</div>
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={newContributionData.description}
                  onChange={(e) => setNewContributionData({...newContributionData, description: e.target.value})}
                  placeholder="Enter description..."
                  rows={3}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createContribution}
                disabled={creatingContribution || isEncrypting || !newContributionData.name || !newContributionData.score}
                className="submit-btn"
              >
                {creatingContribution || isEncrypting ? "Encrypting..." : "Create Contribution"}
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
              <button onClick={() => setSelectedContribution(null)} className="close-modal">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-info">
                <div className="info-row">
                  <span>Name:</span>
                  <strong>{selectedContribution.name}</strong>
                </div>
                <div className="info-row">
                  <span>Creator:</span>
                  <strong>{selectedContribution.creator}</strong>
                </div>
                <div className="info-row">
                  <span>Date:</span>
                  <strong>{new Date(selectedContribution.timestamp * 1000).toLocaleString()}</strong>
                </div>
                <div className="info-row">
                  <span>Public Value:</span>
                  <strong>{selectedContribution.publicValue1}</strong>
                </div>
                <div className="info-row">
                  <span>Description:</span>
                  <p>{selectedContribution.description}</p>
                </div>
              </div>
              
              <div className="encrypted-section">
                <h3>Encrypted Credit Score</h3>
                <div className="encrypted-status">
                  <span>Status: </span>
                  <strong>{selectedContribution.isVerified ? 
                    `✅ Verified: ${selectedContribution.decryptedValue}` : 
                    "🔒 FHE Encrypted"
                  }</strong>
                </div>
                
                <button 
                  onClick={() => decryptData(selectedContribution.id)}
                  disabled={isDecrypting || selectedContribution.isVerified}
                  className="decrypt-btn"
                >
                  {isDecrypting ? "Decrypting..." : 
                   selectedContribution.isVerified ? "Already Verified" : "Decrypt Score"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>DAO Credit FHE - Private Social Credit System</p>
          <div className="footer-links">
            <span>Powered by Zama FHE</span>
            <span>•</span>
            <span>Privacy First</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
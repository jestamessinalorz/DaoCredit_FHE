pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DaoCreditFHE is ZamaEthereumConfig {
    struct Contribution {
        address member;
        euint32 encryptedScore;
        uint256 timestamp;
        uint32 decryptedScore;
        bool isVerified;
    }

    struct Member {
        address addr;
        uint32 totalScore;
        uint32 contributionCount;
        uint32 lastUpdated;
        bool exists;
    }

    mapping(address => Member) public members;
    mapping(string => Contribution) public contributions;
    string[] public contributionIds;

    event ContributionAdded(string indexed id, address indexed member);
    event ScoreVerified(string indexed id, uint32 score);
    event MemberUpdated(address indexed member, uint32 totalScore);

    constructor() ZamaEthereumConfig() {}

    function addContribution(
        string calldata id,
        externalEuint32 encryptedScore,
        bytes calldata inputProof
    ) external {
        require(!contributions[id].isVerified, "Contribution already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedScore, inputProof)), "Invalid encrypted input");

        contributions[id] = Contribution({
            member: msg.sender,
            encryptedScore: FHE.fromExternal(encryptedScore, inputProof),
            timestamp: block.timestamp,
            decryptedScore: 0,
            isVerified: false
        });

        FHE.allowThis(contributions[id].encryptedScore);
        FHE.makePubliclyDecryptable(contributions[id].encryptedScore);

        contributionIds.push(id);

        emit ContributionAdded(id, msg.sender);
    }

    function verifyScore(
        string calldata id,
        bytes memory abiEncodedClearScore,
        bytes memory decryptionProof
    ) external {
        require(!contributions[id].isVerified, "Score already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(contributions[id].encryptedScore);

        FHE.checkSignatures(cts, abiEncodedClearScore, decryptionProof);

        uint32 decodedScore = abi.decode(abiEncodedClearScore, (uint32));
        contributions[id].decryptedScore = decodedScore;
        contributions[id].isVerified = true;

        _updateMemberScore(contributions[id].member, decodedScore);

        emit ScoreVerified(id, decodedScore);
        emit MemberUpdated(contributions[id].member, members[contributions[id].member].totalScore);
    }

    function _updateMemberScore(address member, uint32 score) private {
        if (!members[member].exists) {
            members[member] = Member({
                addr: member,
                totalScore: 0,
                contributionCount: 0,
                lastUpdated: 0,
                exists: true
            });
        }

        members[member].totalScore += score;
        members[member].contributionCount++;
        members[member].lastUpdated = block.timestamp;
    }

    function getContribution(string calldata id) external view returns (
        address member,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedScore
    ) {
        Contribution storage c = contributions[id];
        require(c.timestamp > 0, "Contribution does not exist");
        return (c.member, c.timestamp, c.isVerified, c.decryptedScore);
    }

    function getAllContributionIds() external view returns (string[] memory) {
        return contributionIds;
    }

    function getMember(address memberAddr) external view returns (
        uint32 totalScore,
        uint32 contributionCount,
        uint32 lastUpdated,
        bool exists
    ) {
        Member storage m = members[memberAddr];
        return (m.totalScore, m.contributionCount, m.lastUpdated, m.exists);
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}



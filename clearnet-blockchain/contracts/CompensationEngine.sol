// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { IZkVerifier } from "./interfaces/IZkVerifier.sol";

/**
 * @title CompensationEngine
 * @dev Moteur de compensation bilatérale (netting) pour ClearNet.
 * MVP : positions nettes par compte, réglées par un admin.
 * Extension ZK (désactivée par défaut) : si `zkRequired` est activé par
 * l'admin, seul `settleWithProof()` exécute le règlement — la preuve Groth16
 * (générée par le backend ZkProofService) est vérifiée avant exécution,
 * sans révéler le montant ni les identités sur la chaîne.
 */
contract CompensationEngine {
    address public admin;

    mapping(address => int256) public netPositions;

    // --- Intégration ZK (feature flag on-chain, défaut=false) ---
    address public zkbVerifier;
    bool public zkRequired;
    uint256 public maxAmount;

    event PositionUpdated(address indexed account, int256 netPosition);
    event Compensated(address indexed from, address indexed to, uint256 amount);
    event ZkSettingsUpdated(address verifier, bool required, uint256 maxAmount);
    // V1.4 Axe 4 : transfert d'admin (ex. au MultiSigWallet 2/3).
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    constructor()  {
        admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "CompensationEngine: not admin");
        _;
    }

    /**
     * @dev V1.4 Axe 4 : délègue l'admin au MultiSigWallet (les règlements
     * seront alors exécutés par le multisig après 2/3 confirmations).
     * Note : `admin` n'est plus immutable (ABI de lecture inchangée).
     */
    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "CompensationEngine: zero admin");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }

    function updatePosition(address account, int256 delta) external onlyAdmin {
        netPositions[account] += delta;
        emit PositionUpdated(account, netPositions[account]);
    }

    /**
     * @dev Active/désactive l'exigence de preuve ZK pour le règlement.
     * zkRequired par défaut à false : comportement V1.1 strictement préservé.
     */
    function setZkSettings(address verifier, bool required, uint256 _maxAmount) external onlyAdmin {
        zkbVerifier = verifier;
        zkRequired = required;
        maxAmount = _maxAmount;
        emit ZkSettingsUpdated(verifier, required, _maxAmount);
    }

    function settle(
        address from,
        address to,
        uint256 amount
    ) external onlyAdmin {
        _settle(from, to, amount);
    }

    /**
     * @dev Règlement avec preuve de compensation (Groth16).
     * input = [maxAmount, commitment] — ordre des signaux publics du circuit
     * (main { public [ maxAmount, commitment ] }).
     */
    function settleWithProof(
        address from,
        address to,
        uint256 amount,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[2] calldata input
    ) external onlyAdmin {
        if (zkRequired) {
            require(amount > 0 && amount <= maxAmount, "CompensationEngine: amount out of ZK bounds");
            require(
                IZkVerifier(zkbVerifier).verifyProof(a, b, c, input),
                "CompensationEngine: invalid zk proof"
            );
        }
        _settle(from, to, amount);
    }

    function _settle(address from, address to, uint256 amount) private {
        require(netPositions[from] >= int256(amount), "CompensationEngine: insufficient credit");
        require(netPositions[to] <= 0, "CompensationEngine: counterparty has no debt");
        netPositions[from] -= int256(amount);
        netPositions[to] += int256(amount);
        emit Compensated(from, to, amount);
    }
}

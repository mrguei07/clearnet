// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @title MultiSigWallet (2/3) - V1.4 Axe 4
/// @notice Portefeuille de signature déléguée. Le backend (owner 1) soumet la
///         transaction compilée ; 2 confirmations (dont la soumission) requises
///         avant exécution. Aucune clé privée supplémentaire détenue par le
///         backend : les owners 2 et 3 signent hors-ligne (scripts ops).
/// @dev Basé sur le standard Gnosis Safe simplifié (submit/confirm/execute).
///      Note : n'hérite PAS d'OZ Ownable — sa modifier onlyOwner (4.9.x, non
///      virtual) entrerait en collision avec la nôtre (gouvernance du multisig
///      = ses propres owners, pas besoin d'un owner unique).
contract MultiSigWallet {
    uint256 public constant REQUIRED = 2;      // 2/3 (GRACE: ne pas descendre)
    uint256 public transactionCount;

    struct Transaction {
        address destination;
        uint256 value;
        bytes data;
        bool executed;
        uint256 confirmations;
        uint256 timestamp;
    }

    mapping(uint256 => Transaction) public transactions;
    mapping(uint256 => mapping(address => bool)) public isConfirmed;
    mapping(address => bool) public isOwner;
    address[] public owners;

    event Submission(uint256 indexed txId, address indexed destination, bytes data);
    event Confirmation(address indexed owner, uint256 indexed txId);
    event Execution(uint256 indexed txId, address indexed destination);
    event Revocation(address indexed owner, uint256 indexed txId);

    modifier onlyOwner() {
        require(isOwner[msg.sender], "not an owner");
        _;
    }
    modifier txExists(uint256 txId) { require(txId < transactionCount, "tx does not exist"); _; }
    modifier notExecuted(uint256 txId) { require(!transactions[txId].executed, "tx already executed"); _; }
    modifier notConfirmed(uint256 txId) { require(!isConfirmed[txId][msg.sender], "tx already confirmed"); _; }

    constructor(address[] memory _owners) {
        require(_owners.length >= REQUIRED, "owners < REQUIRED");
        for (uint256 i = 0; i < _owners.length; i++) {
            require(_owners[i] != address(0), "zero owner");
            require(!isOwner[_owners[i]], "duplicate owner");
            isOwner[_owners[i]] = true;
            owners.push(_owners[i]);
        }
    }

    function submitTransaction(address destination, uint256 value, bytes memory data)
        external onlyOwner returns (uint256 txId)
    {
        txId = transactionCount++;
        transactions[txId] = Transaction(destination, value, data, false, 1, block.timestamp);
        isConfirmed[txId][msg.sender] = true;
        emit Submission(txId, destination, data);
        emit Confirmation(msg.sender, txId);
    }

    function confirmTransaction(uint256 txId)
        external onlyOwner txExists(txId) notExecuted(txId) notConfirmed(txId)
    {
        transactions[txId].confirmations++;
        isConfirmed[txId][msg.sender] = true;
        emit Confirmation(msg.sender, txId);
        if (transactions[txId].confirmations == REQUIRED) {
            _execute(txId); // exécution immédiate à la 2ème signature (appel INTERNE :
                            // avec `this.executeTransaction`, msg.sender serait le
                            // contrat lui-même -> revert "not an owner")
        }
    }

    function executeTransaction(uint256 txId) public onlyOwner txExists(txId) notExecuted(txId) {
        _execute(txId);
    }

    function _execute(uint256 txId) private txExists(txId) notExecuted(txId) {
        Transaction storage t = transactions[txId];
        require(t.confirmations >= REQUIRED, "not enough confirmations");
        t.executed = true;
        (bool success, ) = t.destination.call{value: t.value}(t.data);
        require(success, "execution reverted");
        emit Execution(txId, t.destination);
    }

    function getTransactionCount() external view returns (uint256) { return transactionCount; }
    function getOwners() external view returns (address[] memory) { return owners; }
    function getConfirmations(uint256 txId) external view txExists(txId) returns (address[] memory) {
        address[] memory confirmed = new address[](owners.length);
        uint256 n = 0;
        for (uint256 i = 0; i < owners.length; i++) {
            if (isConfirmed[txId][owners[i]]) { confirmed[n++] = owners[i]; }
        }
        return confirmed;
    }
}
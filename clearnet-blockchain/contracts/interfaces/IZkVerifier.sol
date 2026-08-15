// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Interface minimale du vérificateur Groth16 (généré par
// scripts/generate-zk-keys.sh → contracts/Verifier.sol).
// input : signaux publics du circuit transaction.circom, dans l'ordre
// déclaré [maxAmount, commitment] (2 entrées).
interface IZkVerifier {
    function verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[2] memory input
    ) external view returns (bool);
}
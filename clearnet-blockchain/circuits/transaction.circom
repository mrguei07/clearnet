pragma circom 2.1.0;

include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";

/**
 * @title transaction.circom — Compensation ZK pour ClearNet
 *
 * Preuve qu'une compensation est permise sans révéler les entrées privées :
 *   - sender   (private) : identifiant de l'émetteur
 *   - receiver (private) : identifiant du destinataire
 *   - amount   (private) : montant compensé
 *   - commitment (public) : Poseidon(sender, receiver, amount)
 *   - maxAmount  (public) : plafond (ex. 1_000_000)
 *
 * Contraintes :
 *   1. amount > 0
 *   2. amount <= maxAmount
 *   3. commitment === Poseidon(sender, receiver, amount)
 */
template TransactionZK() {
    signal private input sender;
    signal private input receiver;
    signal private input amount;

    signal input maxAmount;
    signal output commitment;

    // --- 1. amount > 0 : borné sur 64 bits et strictement non-nul ---
    component numToBits = Num2Bits(64);
    numToBits.in <== amount;

    component isZero = IsZero();
    isZero.in <== amount;
    isZero.out === 0;

    // --- 2. amount <= maxAmount : équivalent à amount < maxAmount + 1 ---
    component lt = LessThan(64);
    lt.in[0] <== amount;
    lt.in[1] <== maxAmount + 1;
    lt.out === 1;

    // --- 3. engagement public : Poseidon(sender, receiver, amount) ---
    component hasher = Poseidon(3);
    hasher.inputs[0] <== sender;
    hasher.inputs[1] <== receiver;
    hasher.inputs[2] <== amount;
    commitment <== hasher.out;
}

component main { public [ maxAmount, commitment ] } = TransactionZK();
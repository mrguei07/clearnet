// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title AggregatorV3Interface
 * @dev Interface minimale des flux Chainlink (DataFeed) — déclarée en dur
 * pour éviter une dépendance npm auprès de chainlink/contracts au build.
 */
interface AggregatorV3Interface {
    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint256);

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}

/**
 * @title ChainlinkPriceFeed
 * @dev Oracle de prix agrégé pour ClearNet (Phase 2) : ETH/USD, BTC/USD,
 * XAU/USD (or métal, couverture des revenus d'exploitation).
 * Expire quand un flux est non frais (stale) — sécurité oracle.
 * Adresses des DataFeeds par réseau :
 *  - Ethereum mainnet  : ETH/USD 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419,
 *    BTC/USD 0xf4030086522a5beea4988f8d5e0fF308a4c8eea5 (BTC/USD sepolia),
 *    XAU/USD 0x214eD9NnEhB2f52cffF5F7GpD7665f8AF9B81B6.
 * L'adresse par défaut est injectée par le Helm chart lorsque le DataFeed
 * est opérationnel ; le contrat déclare uniquement la logique de lecture.
 */
contract ChainlinkPriceFeed {
    uint256 public constant MAX_STALE_AGE = 24 hours;

    address public immutable ethUsdFeed;
    address public immutable btcUsdFeed;
    address public immutable xauUsdFeed;
    address public immutable owner;

    // Cache horodaté de la dernière MAJ (batched updates autorisées)
    uint256 public lastUpdateAt;
    uint256 public lastEthUsd;
    uint256 public lastBtcUsd;
    uint256 public lastXauUsd;

    event PriceUpdated(
        string symbol,
        uint256 price,
        uint256 updatedAt
    );

    constructor(
        address _ethUsdFeed,
        address _btcUsdFeed,
        address _xauUsdFeed
    ) {
        require(
            _ethUsdFeed != address(0) &&
                _btcUsdFeed != address(0) &&
                _xauUsdFeed != address(0),
            "ChainlinkPriceFeed: zero feed address"
        );
        ethUsdFeed = _ethUsdFeed;
        btcUsdFeed = _btcUsdFeed;
        xauUsdFeed = _xauUsdFeed;
        owner = msg.sender;
    }

    function _read(address feed) internal view returns (uint256 price, uint256 updatedAt) {
        (, int256 answer, uint256 _updatedAt, uint80 answeredInRound) =
            AggregatorV3Interface(feed).latestRoundData();
        require(answeredInRound > 0, "ChainlinkPriceFeed: incomplete round");
        require(_updatedAt > 0, "ChainlinkPriceFeed: no update");
        require(block.timestamp - _updatedAt <= MAX_STALE_AGE, "ChainlinkPriceFeed: stale feed");
        require(answer > 0, "ChainlinkPriceFeed: non-positive answer");
        return (uint256(answer), _updatedAt);
    }

    function getEthUsd() external view returns (uint256) {
        (uint256 price, ) = _read(ethUsdFeed);
        return price;
    }

    function getBtcUsd() external view returns (uint256) {
        (uint256 price, ) = _read(btcUsdFeed);
        return price;
    }

    function getXauUsd() external view returns (uint256) {
        (uint256 price, ) = _read(xauUsdFeed);
        return price;
    }

    function getPrices()
        external
        view
        returns (uint256 ethUsd, uint256 btcUsd, uint256 xauUsd)
    {
        (uint256 a, uint256 b2, uint256 c2, ) = _readMany(ethUsdFeed, btcUsdFeed, xauUsdFeed);
        ethUsd = a;
        btcUsd = b2;
        xauUsd = c2;
    }

    /**
     * @dev Rafraîchit les valeurs mémorisées (gaz réduit pour l'appelant
     * fréquent — le backend OracleService lit soit sur la chaîne, soit sur
     * l'agrégateur HTTP en fallback).
     */
    function refresh() external {
        (uint256 ethUsd, uint256 btcUsd, uint256 xauUsd, ) =
            _readMany(ethUsdFeed, btcUsdFeed, xauUsdFeed);
        lastEthUsd = ethUsd;
        lastBtcUsd = btcUsd;
        lastXauUsd = xauUsd;
        lastUpdateAt = block.timestamp;
        emit PriceUpdated("ETH_USD", ethUsd, block.timestamp);
        emit PriceUpdated("BTC_USD", btcUsd, block.timestamp);
        emit PriceUpdated("XAU_USD", xauUsd, block.timestamp);
    }

    function _readMany(address f1, address f2, address f3)
        internal view
        returns (uint256 p1, uint256 p2, uint256 p3, uint256 ts)
    {
        (p1, ts) = _read(f1);
        (p2, ) = _read(f2);
        (p3, ) = _read(f3);
    }
}
require('dotenv').config();
const { getWeb3, switchRpc } = require('./config/web3');
const { wrap } = require('./src/module/wrap/wrap');
const { unwrap } = require('./src/module/wrap/unwrap');
const BN = require('bn.js');
const fs = require('fs');
const path = require('path');

const TRACKER_DIRECTORY = path.join(__dirname, 'tracker');

// Ensure the tracker directory exists
if (!fs.existsSync(TRACKER_DIRECTORY)) {
    fs.mkdirSync(TRACKER_DIRECTORY);
}

const wallets = [
    {
        address: process.env.WALLET_ADDRESS_1,
        privateKey: process.env.PRIVATE_KEY_1
    },
    {
        address: process.env.WALLET_ADDRESS_2,
        privateKey: process.env.PRIVATE_KEY_2
    },
    {
        address: process.env.WALLET_ADDRESS_3,
        privateKey: process.env.PRIVATE_KEY_3
    }
    // add more as needed
];

// adjust as needed

const MIN_TRANSACTIONS_PER_DAY = 130; 
const MAX_TRANSACTIONS_PER_DAY = 140;

function randomGasPrice(web3Instance) {
    const minGwei = new BN(web3Instance.utils.toWei('0.05', 'gwei'));
    const maxGwei = new BN(web3Instance.utils.toWei('0.054', 'gwei'));
    const randomGwei = minGwei.add(new BN(Math.floor(Math.random() * (maxGwei.sub(minGwei).toNumber()))));
    return randomGwei;
}

function getTrackerFileName(walletIndex) {
    return path.join(TRACKER_DIRECTORY, `tracker_wallet_${walletIndex + 11}.json`);
}

function readTracker(walletIndex) {
    const fileName = getTrackerFileName(walletIndex);
    if (fs.existsSync(fileName)) {
        const data = fs.readFileSync(fileName, 'utf8');
        return JSON.parse(data);
    }
    return {};
}

function writeTracker(walletIndex, tracker) {
    const fileName = getTrackerFileName(walletIndex);
    fs.writeFileSync(fileName, JSON.stringify(tracker, null, 2), 'utf8');
}

async function getNonce(web3Instance, walletAddress) {
    return await web3Instance.eth.getTransactionCount(walletAddress, 'pending');
}

async function executeTransaction(action, gasPriceWei, wallet, walletIndex, iterationCount, ...args) {
    let web3Instance = getWeb3();
    while (true) {
        try {
            const gasLimit = new BN(100000);
            const totalTxCost = gasLimit.mul(new BN(gasPriceWei));
            const balanceWei = await web3Instance.eth.getBalance(wallet.address);
            const balance = new BN(balanceWei);

            if (balance.lt(totalTxCost)) {
                console.log(`[${new Date().toISOString()}] Wallet ${walletIndex + 11}: Insufficient funds to cover the transaction cost. Transaction skipped.`);
                return;
            }

            const localNonce = await getNonce(web3Instance, wallet.address);
            return await action(...args, gasPriceWei.toString(), localNonce, wallet.address, wallet.privateKey);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Wallet ${walletIndex + 11}, Transaction ${iterationCount + 1}: Error executing transaction: ${error.message}`);
            if (error.message.includes("Invalid JSON RPC response")) {
                console.log("Retrying...");
                web3Instance = switchRpc();
            } else if (error.message.includes("nonce too low")) {
                console.log("Nonce too low, retrying with new nonce...");
            } else {
                await new Promise(resolve => setTimeout(resolve, 300000)); // Wait 5 minutes before retrying
            }
        }
    }
}

async function runTransactionsForWallet(wallet, walletIndex) {
    while (true) {
        let tracker = readTracker(walletIndex);
        const transactionsPerDay = Math.floor(Math.random() * (MAX_TRANSACTIONS_PER_DAY - MIN_TRANSACTIONS_PER_DAY + 1)) + MIN_TRANSACTIONS_PER_DAY;

        const currentDay = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format

        if (!tracker[currentDay]) {
            tracker[currentDay] = 0;
        }

        let iterationCount = tracker[currentDay];

        // Generate a random start hour for the 4-hour pause window (UTC hour 0-19)
        const pauseStartHour = Math.floor(Math.random() * 20);

        while (tracker[currentDay] < transactionsPerDay) {
            const currentHourUTC = new Date().getUTCHours();
            const currentDate = new Date().getUTCDate();

            // Check if a new UTC day has started
            if (currentDay !== new Date().toISOString().split('T')[0]) {
                tracker[currentDay] = 0;
                tracker[new Date().toISOString().split('T')[0]] = 0;
                writeTracker(walletIndex, tracker);
                break;
            }

            // Check if current hour is within the 4-hour pause window
            const isWithinPauseWindow = currentHourUTC >= pauseStartHour && currentHourUTC < (pauseStartHour + 4) % 24;

            if (!isWithinPauseWindow) {
                const web3Instance = getWeb3();
                const gasPriceWei = randomGasPrice(web3Instance);

                const balanceWei = await web3Instance.eth.getBalance(wallet.address);
                const balance = new BN(balanceWei);
                const gasLimit = new BN(500000);
                const totalTxCost = gasLimit.mul(gasPriceWei);

                console.log(`[${new Date().toISOString()}] Wallet ${walletIndex + 11}, Transaction ${iterationCount + 1}:`);
                console.log(`Gas Limit: ${gasLimit.toString()}, Gas Price: ${web3Instance.utils.fromWei(gasPriceWei, 'gwei')} Gwei`);
                console.log(`Total Tx Cost: ${web3Instance.utils.fromWei(totalTxCost.toString(), 'ether')} ETH`);

                if (balance.lt(totalTxCost)) {
                    console.log(`[${new Date().toISOString()}] Wallet ${walletIndex + 11}: Insufficient funds to cover the transaction cost. Transaction skipped.`);
                    break;
                }

                // Wrap
                const wrapAmountMin = 0.003;
                const wrapAmountMax = 0.005;
                let wrapAmount = Math.random() * (wrapAmountMax - wrapAmountMin) + wrapAmountMin;
                wrapAmount = parseFloat(wrapAmount.toFixed(6));
                let txHash = await executeTransaction(wrap, gasPriceWei, wallet, walletIndex, iterationCount, wrapAmount);
                if (!txHash) break;
                let txLink = `https://taikoscan.io/tx/${txHash}`;
                console.log(`[${new Date().toISOString()}] Wallet ${walletIndex + 11}, Transaction ${iterationCount + 1}: Wrap Transaction sent: ${txLink}, Amount: ${wrapAmount} ETH`);

                // Random delay before Unwrap (0 to 5 minutes)
                const randomDelay = Math.floor(Math.random() * 300000); // Random delay up to 5 minutes
                console.log(`[${new Date().toISOString()}] Wallet ${walletIndex + 11}, Transaction ${iterationCount + 1}: Waiting ${randomDelay / 1000} seconds before Unwrap.`);
                await new Promise(resolve => setTimeout(resolve, randomDelay));

                // Unwrap
                txHash = await executeTransaction(unwrap, gasPriceWei, wallet, walletIndex, iterationCount, wrapAmount);
                if (!txHash) break;

                console.log(`[${new Date().toISOString()}] Wallet ${walletIndex + 11}, Transaction ${iterationCount + 1}: Unwrap Transaction sent: https://taikoscan.io/tx/${txHash}`);

                tracker[currentDay]++;
            } else {
                console.log(`[${new Date().toISOString()}] Wallet ${walletIndex + 11}: Transactions skipped during the UTC hour ${currentHourUTC}.`);
            }

            writeTracker(walletIndex, tracker);

            iterationCount++;
            const waitTime = Math.floor(86400000 / transactionsPerDay); // Calculate wait time in milliseconds for even distribution across the day
            console.log(`[${new Date().toISOString()}] Wallet ${walletIndex + 11}, Transaction ${iterationCount + 1}: Waiting for ${waitTime / 1000} seconds before the next transaction.`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        console.log(`[${new Date().toISOString()}] Wallet ${walletIndex + 11}: Transactions completed for the day. Waiting for new UTC day to start.`);
        while (currentDay === new Date().toISOString().split('T')[0]) {
            await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 minute before checking again
        }
    }
}

async function main() {
    const promises = wallets.map((wallet, index) => runTransactionsForWallet(wallet, index));
    await Promise.all(promises);
}

main().catch(err => console.error(err));

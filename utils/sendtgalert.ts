import TelegramBot from 'node-telegram-bot-api';
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } from '../constants';
import { logger } from './logger';





export async function sendNewTokenAlert(mintAddress: string) {
    const telegramBotToken = String(TELEGRAM_BOT_TOKEN);
    const telegramChatId = String(TELEGRAM_CHAT_ID);
    const bot = new TelegramBot(telegramBotToken, { polling: false });
    // await bot
    //     .getChat(channelUserName)
    //     .then((chat: any) => {
    //         channelId = chat.id;
    //     });
    const message = `
    😊New Token Detected!😊
    Mint Address: ${mintAddress} \n
    https://gmgn.ai/sol/token/${mintAddress}
    `;
    try {
        await bot.sendMessage(telegramChatId, message);

    } catch (error) {
        console.error('Error sending Telegram alert:', error);
    }
}

// export async function sendTradingWalletAlert(address: string) {

//     // await bot
//     //     .getChat(channelUserName)
//     //     .then((chat: any) => {
//     //         channelId = chat.id;
//     //     });
//     const message = `
//     😎New Wallet Detected!😎
//     Mint Address: ${address} \n
//     https://gmgn.ai/sol/address/${address}
//     `;
//     try {
//         await bot.sendMessage(telegramChatId, message);
//         console.log('😊😊😊Telegram alert sent.');
//     } catch (error) {
//         console.error('Error sending Telegram alert:', error);
//     }
// }

// export async function sendFinishAlert(
//     walletPubkey: string,
//     pnl: number, 
//     trade_count: number, 
//     total_trade_amount: number, 
//     win_count: number, 
//     lose_count: number, 
//     current_pool_size: number,
//     finish_message: string
// ) {
//     const message = `
//     👏Trading Finished!👏\n
//     W Address: ${walletPubkey} \n
//     Current Pool Size: ${current_pool_size} \n
//     Trade Count: ${trade_count} \n
//     Total Trade Amount: ${total_trade_amount} \n
//     Total PnL: ${pnl} \n
//     Pnl Percent: ${pnl / total_trade_amount * 100}% \n
//     Win Count: ${win_count} \n
//     Lose Count: ${lose_count} \n
//     Win Rate: ${win_count / trade_count * 100}% \n
//     Close Reason: ${finish_message}
//     `;
//     try {
//         await bot.sendMessage(telegramChatId, message);
//         console.log('😊😊😊Telegram alert sent.');
//     } catch (error) {
//         console.error('Error sending Telegram alert:', error);
//     }
// }
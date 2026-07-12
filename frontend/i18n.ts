/**
 * i18n — every user-facing string routes through this dictionary. The
 * locale is carried in the URL: `/zh/...` renders Mandarin, no prefix
 * renders English (the header's translate toggle switches between them).
 *
 * `tr(locale, key, vars)` interpolates `{var}` placeholders. Client
 * components use the `useI18n()` hook (hooks/useI18n.ts) which derives the
 * locale from the pathname and provides `t()` plus the `p()` href prefixer.
 */

import type { Proposal } from '@/lib/dao/types';
import type { DaoDefinition } from '@/daos';

export type Locale = 'en' | 'zh';

export const LOCALE_PREFIX = '/zh';

type Message = { en: string; zh: string };

export const MESSAGES = {
  // Header / nav
  'nav.proposals': { en: 'Proposals', zh: '提案' },
  'nav.portfolio': { en: 'Portfolio', zh: '资产组合' },
  'nav.nodes': { en: 'Nodes', zh: '节点' },
  'header.connect': { en: 'Connect wallet', zh: '连接钱包' },
  'header.connecting': { en: 'Waiting for SUBFROST…', zh: '等待 SUBFROST…' },
  'header.disconnect': { en: 'Disconnect', zh: '断开连接' },
  'header.origin': { en: 'SUBFROST app origin', zh: 'SUBFROST 应用源' },
  'header.originHint': {
    en: 'The wallet popup opens on this origin.',
    zh: '钱包弹窗将在此源上打开。',
  },
  'header.settingsAria': { en: 'Connection settings', zh: '连接设置' },
  'header.copyAria': { en: 'Copy address', zh: '复制地址' },
  'header.translateAria': { en: 'Switch language', zh: '切换语言' },
  'common.moreInfo': { en: 'More info', zh: '更多信息' },

  // Nodes page
  'nodes.title': { en: 'Surtur nodes', zh: 'Surtur 节点' },
  'nodes.subtitle': {
    en: 'The whitelisted p2p nodes serving proposals and votes.',
    zh: '为提案和投票提供服务的白名单 P2P 节点。',
  },
  'nodes.online': { en: 'Online', zh: '在线' },
  'nodes.offline': { en: 'Offline', zh: '离线' },
  'nodes.latencyMs': { en: '{ms} ms', zh: '{ms} 毫秒' },

  // DAO list
  'daos.title': { en: 'DAOs', zh: 'DAO 列表' },
  'daos.disabled': { en: 'Disabled', zh: '已停用' },

  // DAO proposals page
  'dao.reserves': { en: 'Reserves:', zh: '储备：' },
  'dao.newProposal': { en: 'New proposal', zh: '创建提案' },
  'dao.colProposal': { en: 'Proposal', zh: '提案' },
  'dao.colTransfers': { en: 'Transfers', zh: '转账' },
  'dao.noProposals': { en: 'No proposals yet', zh: '暂无提案' },
  'dao.voteCount': { en: '{n} votes', zh: '{n} 票' },
  'dao.voteCountOne': { en: '1 vote', zh: '1 票' },
  'dao.createFirst': {
    en: "Create the first proposal to put the DAO's {symbol} reserves to work.",
    zh: '创建第一个提案，动用 DAO 的 {symbol} 储备。',
  },
  'dao.noOpen': { en: 'No open proposals.', zh: '没有进行中的提案。' },
  'dao.past': { en: 'Past proposals', zh: '历史提案' },
  'dao.pageInfo': {
    en: 'Page {page} of {pages} · {total} proposals',
    zh: '第 {page} / {pages} 页 · 共 {total} 个提案',
  },
  'dao.prev': { en: 'Prev', zh: '上一页' },
  'dao.next': { en: 'Next', zh: '下一页' },
  'dao.notFound': { en: 'DAO not found', zh: '未找到 DAO' },
  'dao.notFoundHint': {
    en: 'It may have been removed, or the link is wrong.',
    zh: '它可能已被移除，或链接有误。',
  },
  'dao.disabledTitle': { en: '{name} is disabled', zh: '{name} 已停用' },
  'dao.disabledHintProposals': {
    en: 'This DAO is not accepting proposals or votes right now.',
    zh: '该 DAO 目前不接受提案或投票。',
  },
  'dao.disabledHintCreate': {
    en: 'This DAO is not accepting proposals right now.',
    zh: '该 DAO 目前不接受提案。',
  },
  'dao.backToDaos': { en: 'Back to DAOs', zh: '返回 DAO 列表' },
  'dao.toastNeedPrefix': { en: '', zh: '需要' },
  'dao.toastNeedSuffix': {
    en: 'needed to make a proposal',
    zh: '才能创建提案',
  },

  // Shared proposal bits
  'prop.proposer': { en: 'Proposer:', zh: '提案人：' },
  'prop.timeLeft': { en: 'Time left:', zh: '剩余时间：' },
  'prop.blocksLeft': { en: '{n} blocks ({dur})', zh: '{n} 个区块（{dur}）' },
  'prop.blocksLeftRow': { en: '{n} blocks left', zh: '剩余 {n} 个区块' },
  'prop.durLeft': { en: '{dur} left', zh: '剩余 {dur}' },
  'common.ended': { en: 'Ended', zh: '已结束' },

  // Proposal detail
  'prop.notFound': { en: 'Proposal not found', zh: '未找到提案' },
  'prop.backToProposals': { en: 'Back to proposals', zh: '返回提案列表' },
  'prop.transfersProposed': { en: 'Transfers proposed', zh: '提议的转账' },
  'prop.amount': { en: 'Amount', zh: '金额' },
  'prop.noTransfers': {
    en: 'No transfers — this proposal moves no funds.',
    zh: '无转账 — 此提案不涉及资金。',
  },
  'prop.total': { en: 'Total', zh: '合计' },
  'prop.treasuryAfter': { en: 'Treasury after transfers', zh: '转账后金库余额' },
  'prop.closeImageAria': { en: 'Close image', zh: '关闭图片' },

  // Delegations
  'dlg.tabProposals': { en: 'Proposals', zh: '提案' },
  'dlg.tabDelegations': { en: 'Delegations', zh: '委托' },
  'dlg.newDelegation': { en: 'New delegation', zh: '创建委托' },
  'dlg.none': { en: 'No delegations yet', zh: '暂无委托' },
  'dlg.noneHint': {
    en: 'Create a delegation to vote with the combined power of its members.',
    zh: '创建一个委托，以成员的合计票权进行投票。',
  },
  'dlg.signer': { en: 'Signer', zh: '签名人' },
  'dlg.addresses': { en: '{n} addresses', zh: '{n} 个地址' },
  'dlg.addressOne': { en: '1 address', zh: '1 个地址' },
  'dlg.name': { en: 'Delegation name', zh: '委托名称' },
  'dlg.nameZh': { en: 'Chinese name', zh: '中文名称' },
  'dlg.description': { en: 'Description', zh: '描述' },
  'dlg.descriptionPlaceholder': {
    en: 'Describe this delegation — its goals and how it will vote…',
    zh: '描述该委托 — 其目标以及投票方式…',
  },
  'dlg.create': { en: 'Create delegation', zh: '创建委托' },
  'dlg.creating': { en: 'Creating…', zh: '创建中…' },
  'dlg.backToDao': { en: 'Back', zh: '返回' },
  'dlg.delegate': { en: 'Delegate', zh: '委托' },
  'dlg.leave': { en: 'Leave delegation', zh: '退出委托' },
  'dlg.signing': { en: 'Signing…', zh: '签名中…' },
  'dlg.connectToDelegate': { en: 'Connect wallet to delegate', zh: '连接钱包以进行委托' },
  'dlg.youAreMember': {
    en: 'Your voting power is delegated here.',
    zh: '您的票权已委托于此。',
  },
  'dlg.memberElsewhere': {
    en: 'Delegating here moves your voting power from your current delegation.',
    zh: '委托于此将把您的票权从当前委托转移过来。',
  },
  'dlg.totalPower': { en: 'Total delegated', zh: '合计委托' },
  'dlg.members': { en: 'Members', zh: '成员' },
  'dlg.owner': { en: 'Owner', zh: '所有者' },
  'dlg.icon': { en: 'Delegation icon', zh: '委托图标' },
  'dlg.iconHint': { en: 'Optional — up to 5 MB.', zh: '可选 — 最大 5 MB。' },
  'dlg.iconRemove': { en: 'Remove', zh: '移除' },
  'dlg.edit': { en: 'Edit', zh: '编辑' },
  'header.viewDelegation': { en: 'View delegation', zh: '查看委托' },
  'dlg.saveChanges': { en: 'Save changes', zh: '保存更改' },
  'dlg.saving': { en: 'Saving…', zh: '保存中…' },
  'dlg.createdAtBlock': { en: 'Created at block', zh: '创建区块' },
  'dlg.thresholdNote': {
    en: 'Creating a delegation requires holding {pct}% of circulating supply.',
    zh: '创建委托需要持有流通量的 {pct}%。',
  },
  'dlg.nameRequired': { en: 'Name is required.', zh: '名称为必填项。' },
  'dlg.descriptionRequired': { en: 'Description is required.', zh: '描述为必填项。' },
  'dlg.addChinese': { en: 'Add Chinese version', zh: '添加中文版本' },
  'dlg.viaDelegation': { en: 'Delegation', zh: '委托' },
  'dlg.youDelegated': {
    en: 'Your voting power is delegated — your delegation votes for you.',
    zh: '您的票权已委托 — 由您的委托代您投票。',
  },

  // Wallet connect
  'wallet.connectTitle': { en: 'Connect a wallet', zh: '连接钱包' },
  'wallet.passportHint': {
    en: 'Sign in with the SUBFROST webapp popup.',
    zh: '通过 SUBFROST 网页应用弹窗登录。',
  },
  'wallet.mobileHint': {
    en: 'Pair with the SUBFROST mobile app via QR.',
    zh: '通过二维码与 SUBFROST 手机应用配对。',
  },
  'wallet.extensionsSection': { en: 'Browser extensions', zh: '浏览器扩展' },
  'wallet.installed': { en: 'Installed', zh: '已安装' },
  'wallet.notInstalled': { en: 'Not installed →', zh: '未安装 →' },
  'wallet.mobileTitle': { en: 'Pair SUBFROST Mobile', zh: '配对 SUBFROST 手机应用' },
  'wallet.pairingCode': { en: 'Pairing code', zh: '配对码' },
  'wallet.mobileScanHint': {
    en: 'Open the SUBFROST app on your phone and scan this code. Confirm the pairing code matches.',
    zh: '在手机上打开 SUBFROST 应用并扫描此二维码，确认配对码一致。',
  },
  'wallet.mobileNoSend': {
    en: 'Mobile sessions can vote and propose; sending from the portfolio is not available.',
    zh: '手机会话可投票和创建提案；无法从资产页发送。',
  },
  'wallet.preparingPairing': { en: 'Preparing pairing…', zh: '正在准备配对…' },
  'wallet.retryPairing': { en: 'Try again', zh: '重试' },
  'portfolio.sendDisabledMobile': {
    en: 'Sending is not supported with SUBFROST Mobile.',
    zh: 'SUBFROST 手机应用不支持发送。',
  },

  // Resolution
  'resolution.title': { en: 'Resolution', zh: '决议' },
  'resolution.waiting': { en: 'Waiting to be resolved', zh: '等待解决' },
  'resolution.waitingHint': {
    en: 'This proposal passed and awaits its resolution from the DAO resolver.',
    zh: '该提案已通过，正等待 DAO 解决人提供决议。',
  },
  'resolution.resolveButton': { en: 'Resolve Proposal', zh: '解决提案' },
  'resolution.placeholder': {
    en: 'Describe how this proposal was executed…',
    zh: '描述该提案的执行情况…',
  },
  'resolution.cancel': { en: 'Cancel', zh: '取消' },
  'resolution.resolvedBy': { en: 'Resolved by', zh: '解决人' },
  'resolution.empty': { en: 'Write the resolution first.', zh: '请先填写决议内容。' },

  // Votes
  'votes.title': { en: 'Votes', zh: '投票' },
  'votes.for': { en: 'For', zh: '赞成' },
  'votes.abstain': { en: 'Abstain', zh: '弃权' },
  'votes.against': { en: 'Against', zh: '反对' },
  'votes.voteFor': { en: 'Vote For', zh: '投赞成票' },
  'votes.voteAbstain': { en: 'Vote Abstain', zh: '投弃权票' },
  'votes.voteAgainst': { en: 'Vote Against', zh: '投反对票' },
  'votes.connectToVote': { en: 'Connect wallet to vote', zh: '连接钱包以投票' },
  'votes.none': { en: 'No votes cast yet.', zh: '尚无投票。' },
  'votes.noneFor': { en: 'No For votes yet.', zh: '尚无赞成票。' },
  'votes.noneAgainst': { en: 'No Against votes yet.', zh: '尚无反对票。' },
  'votes.moreNeeded': { en: '{pct}% more needed', zh: '还需 {pct}%' },
  'votes.thresholdReached': { en: 'Pass threshold reached', zh: '已达通过阈值' },
  'votes.passedLabel': {
    en: 'Passed — pass threshold reached',
    zh: '已通过 — 达到通过阈值',
  },
  'votes.rejectedLabel': {
    en: 'Rejected — pass threshold not met',
    zh: '已否决 — 未达通过阈值',
  },
  'votes.supplyUnavailable': { en: 'Supply unavailable', zh: '供应量数据不可用' },
  'votes.you': { en: '(you)', zh: '（你）' },

  // Status pill
  'status.open': { en: 'Open', zh: '进行中' },
  'status.passed': { en: 'Passed', zh: '已通过' },
  'status.rejected': { en: 'Rejected', zh: '已否决' },
  'status.executed': { en: 'Executed', zh: '已执行' },

  // Create proposal
  'create.title': { en: 'New proposal', zh: '创建提案' },
  'create.connectHint': {
    en: 'Connect your SUBFROST wallet to create a proposal.',
    zh: '连接你的 SUBFROST 钱包以创建提案。',
  },
  'create.titlePlaceholder': { en: 'Proposal title', zh: '提案标题' },
  'create.bodyPlaceholder': {
    en: 'Describe the proposal — type / for headings, images, lists…',
    zh: '描述提案 — 输入 / 插入标题、图片、列表…',
  },
  'create.zhSection': { en: 'Chinese version (optional)', zh: '中文版本（可选）' },
  'create.zhTip': {
    en: 'If provided, Chinese readers see this version instead of the English one.',
    zh: '如提供，中文读者将看到此版本而非英文版本。',
  },
  'create.addZh': { en: 'Add Chinese version', zh: '添加中文版本' },
  'create.removeZh': { en: 'Remove Chinese version', zh: '移除中文版本' },
  'create.zhTitlePlaceholder': { en: 'Chinese title', zh: '中文标题' },
  'create.zhBodyPlaceholder': {
    en: 'Chinese proposal body…',
    zh: '中文提案内容…',
  },
  'create.transfers': { en: 'Transfers', zh: '转账' },
  'create.transfersTip': {
    en: '{symbol} paid out of the DAO reserves if this proposal passes.',
    zh: '若提案通过，将从 DAO 储备中支付 {symbol}。',
  },
  'create.addTransfer': { en: 'Add transfer', zh: '添加转账' },
  'create.recipientPlaceholder': { en: 'Recipient address (bc1…)', zh: '收款地址（bc1…）' },
  'create.amountAria': { en: 'Transfer amount', zh: '转账金额' },
  'create.removeAria': { en: 'Remove transfer', zh: '移除转账' },
  'create.votingWindow': { en: 'Voting window', zh: '投票窗口' },
  'create.votingWindowTip': {
    en: 'Block heights voting opens and closes at.',
    zh: '投票开始和结束的区块高度。',
  },
  'create.currentBlockIs': {
    en: 'The chain is currently at block {height}.',
    zh: '当前区块高度为 {height}。',
  },
  'create.startBlock': { en: 'Start block', zh: '起始区块' },
  'create.endBlock': { en: 'End block', zh: '结束区块' },
  'create.durationLabel': { en: 'Duration (blocks)', zh: '持续时间（区块）' },
  'create.durationToggle': { en: 'Duration', zh: '持续时间' },
  'create.useCurrentBlock': { en: 'Use current block', zh: '使用当前区块' },
  'create.editBlock': { en: 'Edit block', zh: '编辑区块' },
  'create.currentBlock': { en: 'Current Block', zh: '当前区块' },
  'create.cancel': { en: 'Cancel', zh: '取消' },
  'create.submit': { en: 'Create proposal', zh: '创建提案' },
  'create.blockPassedAt': {
    en: 'Block {block} has already passed — the chain is at {tip}.',
    zh: '区块 {block} 已过去 — 当前区块为 {tip}。',
  },
  'create.thresholdError': {
    en: 'You need at least {pct}% of circulating {symbol} to create a proposal (you hold {held}%).',
    zh: '创建提案需要至少 {pct}% 的流通 {symbol}（你持有 {held}%）。',
  },

  // Validation (zod)
  'err.titleRequired': { en: 'Give the proposal a title.', zh: '请输入提案标题。' },
  'err.titleTooLong': {
    en: 'Keep the title under 200 characters.',
    zh: '标题不能超过 200 个字符。',
  },
  'err.addressRequired': { en: 'Recipient address is required.', zh: '请输入收款地址。' },
  'err.addressInvalid': {
    en: 'Not a valid Bitcoin address for this network.',
    zh: '不是该网络的有效比特币地址。',
  },
  'err.amountFormat': {
    en: 'Enter a token amount (up to 8 decimals).',
    zh: '请输入代币数量（最多 8 位小数）。',
  },
  'err.amountPositive': { en: 'The amount must be greater than zero.', zh: '数量必须大于零。' },
  'err.blockHeight': { en: 'Enter a block height.', zh: '请输入区块高度。' },
  'err.blockHeightValid': { en: 'Enter a valid block height.', zh: '请输入有效的区块高度。' },
  'err.durationBlocks': { en: 'Enter a number of blocks.', zh: '请输入区块数量。' },
  'err.durationPositive': {
    en: 'The duration must be at least one block.',
    zh: '持续时间至少为一个区块。',
  },
  'err.blockPassed': { en: 'Block already passed.', zh: '该区块已过去。' },
  'err.endAfterStart': { en: 'Must be after the start block.', zh: '必须晚于起始区块。' },
  'err.overReserves': {
    en: 'Transfers exceed the treasury reserves ({amount} {symbol} available).',
    zh: '转账总额超过金库储备（可用 {amount} {symbol}）。',
  },
  'err.bodyTooLarge': { en: 'The proposal body is too large.', zh: '提案内容过大。' },
  'err.bodyInvalid': { en: 'The proposal body is invalid.', zh: '提案内容无效。' },
  'err.transferInvalid': {
    en: 'Every transfer needs a recipient address and a positive amount.',
    zh: '每笔转账都需要收款地址和正数金额。',
  },
  'err.imageNotFile': { en: 'Not a file.', zh: '不是文件。' },
  'err.imageType': { en: 'Only image files can be embedded.', zh: '只能嵌入图片文件。' },
  'err.imageSize': { en: 'Images must be 5 MB or smaller.', zh: '图片不能超过 5 MB。' },
  'err.invalid': { en: 'Invalid value.', zh: '无效的值。' },

  // Portfolio
  'portfolio.title': { en: 'Portfolio', zh: '资产组合' },
  'portfolio.connectHint': {
    en: 'Connect your SUBFROST wallet to see your assets.',
    zh: '连接你的 SUBFROST 钱包以查看资产。',
  },
  'portfolio.refresh': { en: 'Refresh', zh: '刷新' },
  'portfolio.asset': { en: 'Asset', zh: '资产' },
  'portfolio.balance': { en: 'Balance', zh: '余额' },
  'portfolio.loading': { en: 'Loading…', zh: '加载中…' },
  'portfolio.noTokens': { en: 'No alkane tokens found', zh: '未找到 alkane 代币' },
  'portfolio.pending': { en: '{amount} pending', zh: '{amount} 待确认' },
  'portfolio.send': { en: 'Send', zh: '发送' },

  // Send modal / tx status
  'send.title': { en: 'Send {symbol}', zh: '发送 {symbol}' },
  'send.recipient': { en: 'Recipient address', zh: '收款地址' },
  'send.amount': { en: 'Amount', zh: '金额' },
  'send.balance': { en: 'Balance: {amount}', zh: '余额：{amount}' },
  'send.advanced': { en: 'Advanced', zh: '高级选项' },
  'send.feeRate': { en: 'Fee rate (sat/vB)', zh: '费率（sat/vB）' },
  'send.send': { en: 'Send', zh: '发送' },
  'send.cancelled': { en: 'Signing was cancelled.', zh: '签名已取消。' },
  'send.closeAria': { en: 'Close', zh: '关闭' },
  'tx.building': { en: 'Building transaction…', zh: '正在构建交易…' },
  'tx.buildingSub': {
    en: 'Constructing the unsigned transaction.',
    zh: '正在构建未签名交易。',
  },
  'tx.waiting': { en: 'Waiting for confirmation', zh: '等待确认' },
  'tx.waitingSub': {
    en: 'Review and sign in the SUBFROST popup. Closing the popup cancels.',
    zh: '请在 SUBFROST 弹窗中检查并签名。关闭弹窗即取消。',
  },
  'tx.broadcasting': { en: 'Broadcasting…', zh: '正在广播…' },
  'tx.broadcastingSub': {
    en: 'Submitting the signed transaction to the network.',
    zh: '正在将已签名交易提交至网络。',
  },
  'tx.success': { en: 'Transaction broadcast', zh: '交易已广播' },
  'tx.failed': { en: 'Transaction failed', zh: '交易失败' },
  'tx.view': { en: 'View on espo.sh', zh: '在 espo.sh 查看' },
  'tx.done': { en: 'Done', zh: '完成' },
  'tx.back': { en: 'Back', zh: '返回' },
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof MESSAGES;

export function tr(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let out: string = MESSAGES[key][locale];
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
  }
  return out;
}

export function localeFromPathname(pathname: string): Locale {
  return pathname === LOCALE_PREFIX || pathname.startsWith(`${LOCALE_PREFIX}/`) ? 'zh' : 'en';
}

/** Prefix an app href with the active locale ("/proposals" → "/zh/proposals"). */
export function localePath(locale: Locale, href: string): string {
  return locale === 'zh' ? `${LOCALE_PREFIX}${href}` : href;
}

/** The pathname without its locale prefix (for nav-active checks). */
export function stripLocale(pathname: string): string {
  if (pathname === LOCALE_PREFIX) return '/';
  return pathname.startsWith(`${LOCALE_PREFIX}/`) ? pathname.slice(LOCALE_PREFIX.length) : pathname;
}

// --- Locale-aware content selection -----------------------------------------

/** Chinese title when viewing in zh and the proposer provided one. */
export function proposalTitle(p: Proposal, locale: Locale): string {
  return locale === 'zh' && p.titleZh?.trim() ? p.titleZh : p.title;
}

/** Chinese body when viewing in zh and the proposer provided one. */
export function proposalBody(p: Proposal, locale: Locale): string {
  return locale === 'zh' && p.bodyZh?.trim() ? p.bodyZh : p.body;
}

export function daoDescription(dao: DaoDefinition, locale: Locale): string | undefined {
  return locale === 'zh' ? (dao.descriptionZh ?? dao.description) : dao.description;
}

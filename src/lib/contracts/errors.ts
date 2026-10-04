import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Mensajes para los errores custom de los contratos, en el idioma de la interfaz. */
const REVERT_MESSAGES: Record<string, string> = {
  // Registro de identidad y token
  InvestorNotVerified: "La billetera no tiene una verificación de identidad vigente en esta red.",
  TransfersDisabled: "Las transferencias entre inversores todavía no están habilitadas para este token.",
  EnforcedPause: "Las operaciones están pausadas en este momento.",
  // Ronda (TokenOffering)
  OfferingNotOpen: "La ronda no está recibiendo inversiones en este momento.",
  BelowMinimumPurchase: "El monto es menor al ticket mínimo del proyecto.",
  HardCapExceeded: "El monto supera el cupo disponible de la ronda.",
  ZeroAmount: "El monto es demasiado chico para recibir tokens.",
  RefundsNotAvailable: "Los reembolsos no están habilitados para esta ronda.",
  NothingToRefund: "No tenés aportes para reembolsar en esta ronda.",
  NothingToClaim: "No tenés distribuciones pendientes de cobro.",
  CannotFinalize: "La ronda todavía no se puede cerrar.",
  // Pagos con otras monedas (PaymentRouter)
  AssetNotAccepted: "Esa moneda no está habilitada para pagar en esta red.",
  Expired: "La cotización venció antes de confirmarse. Volvé a intentarlo.",
  SlippageExceeded: "El precio de la moneda se movió más que la tolerancia. Volvé a cotizar e intentá de nuevo.",
  BadNativeValue: "El monto enviado no coincide con la cotización. Volvé a intentarlo.",
  // Mercado secundario (P2PMarket)
  TokenNotListed: "Este token todavía no está habilitado en el mercado secundario.",
  OrderTooSmall: "La orden no llega al valor mínimo del mercado.",
  FillTooSmall: "Cada toma parcial tiene que valer al menos USD 1.",
  InsufficientBalance: "No tenés saldo suficiente para esa operación.",
  InsufficientAllowance: "Falta autorizar al mercado a usar tus fondos.",
  OrderNotActive: "Esa orden ya no está activa: la tomó otra persona o se retiró.",
  SelfTrade: "No podés tomar tu propia orden.",
  NotOrderMaker: "Solo quien publicó la orden puede retirarla.",
  InvalidAmount: "Revisá la cantidad: tiene que ser mayor a cero y no superar lo disponible.",
  // ERC-20
  ERC20InsufficientBalance: "No tenés saldo suficiente.",
  ERC20InsufficientAllowance: "Falta autorizar el uso de tus fondos.",
  FaucetLimitExceeded: "La canilla de prueba tiene un límite por pedido. Pedí un monto menor.",
};

/** Convierte cualquier error de viem/wagmi en un mensaje accionable. */
export function describeTxError(error: unknown): string {
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError)) {
      return "Cancelaste la operación en tu billetera.";
    }
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name && REVERT_MESSAGES[name]) return REVERT_MESSAGES[name];
      if (name) return `La operación fue rechazada por el contrato (${name}).`;
    }
    if (/insufficient funds/i.test(error.message)) {
      return "No tenés saldo suficiente para pagar la comisión de red (gas).";
    }
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return "No se pudo completar la operación.";
}

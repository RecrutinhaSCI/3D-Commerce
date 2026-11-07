import { env } from '../../../config/env';
import { prisma } from '../../../lib/prisma';
import { ensureSettings } from '../../settings/settings.service';
import { resolveMelhorEnvioConfig, resolveMelhorEnvioLabelsConfig } from '../melhorEnvioConfig';
import { parseStoredSender, senderReadiness, suggestSender, type ShippingSender } from './sender';

/** CEP de origem da cotação (SHIPPING_ORIGIN_CEP já normalizado), ou null. */
const originCep = () => resolveMelhorEnvioConfig(env).originCep;

export const labelsService = {
  /**
   * Estado das travas + prontidão do remetente. Nunca devolve token nem
   * valores de variáveis — só booleanos e mensagens.
   */
  async getConfig() {
    const cfg = resolveMelhorEnvioLabelsConfig(env);
    const settings = await ensureSettings();
    const sender = parseStoredSender(settings.shippingSenderJson);
    return {
      enabled: cfg.enabled,
      environment: cfg.environment,
      isTest: cfg.isTest,
      purchaseAllowed: cfg.purchaseAllowed,
      blockedReason: cfg.blockedReason,
      sender: senderReadiness(sender, originCep()),
    };
  },

  /** Remetente salvo (ou null) + sugestão a partir das configurações da loja. */
  async getSender() {
    const settings = await ensureSettings();
    const sender = parseStoredSender(settings.shippingSenderJson);
    return {
      sender,
      suggestion: sender ? null : suggestSender(settings, originCep()),
      readiness: senderReadiness(sender, originCep()),
    };
  },

  /** `input` já validado por `senderSchema`. */
  async updateSender(input: ShippingSender) {
    await ensureSettings();
    await prisma.siteSettings.update({ where: { id: 'main' }, data: { shippingSenderJson: input } });
    return { sender: input, suggestion: null, readiness: senderReadiness(input, originCep()) };
  },
};

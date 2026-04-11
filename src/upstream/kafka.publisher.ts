/**
 * Kafka Publisher
 *
 * Telemetri mesajlarini backend Kafka topic'lerine gonderir.
 * mes.telemetry.raw formatinda - backend'in TelemetryConsumerService'i dinliyor.
 */

import { Kafka, Producer, CompressionTypes } from 'kafkajs';
import type { TagValue } from '../telemetry/tag.generator';
import type { MachineStatus } from '../config/factory.config';

const TOPICS = {
  TELEMETRY_RAW: 'mes.telemetry.raw',
  MACHINE_STATUS: 'mes.telemetry.machine-status',
  ALARMS: 'mes.telemetry.alarms',
};

export class KafkaPublisher {
  private producer: Producer;
  private connected = false;

  constructor(brokers: string[]) {
    const kafka = new Kafka({
      clientId: 'fabriq-simulator',
      brokers,
      retry: { retries: 5, initialRetryTime: 1000 },
    });
    this.producer = kafka.producer();
  }

  async connect() {
    await this.producer.connect();
    this.connected = true;
    console.log('[Kafka] Publisher baglandi');
  }

  async disconnect() {
    await this.producer.disconnect();
    this.connected = false;
    console.log('[Kafka] Publisher kapandi');
  }

  /**
   * Telemetri verisi gonder (mes.telemetry.raw)
   */
  async publishTelemetry(
    edgeId: string,
    deviceId: string,
    tags: TagValue[],
    activeJobOrderId?: string,
  ) {
    if (!this.connected) return;

    const message = {
      edgeId,
      deviceId,
      timestamp: new Date().toISOString(),
      activeJobOrderId,
      tags: tags.map((t) => ({
        tagId: t.tagId,
        name: t.name,
        value: t.value,
        quality: t.quality,
        unit: t.unit,
      })),
    };

    await this.producer.send({
      topic: TOPICS.TELEMETRY_RAW,
      compression: CompressionTypes.GZIP,
      messages: [{
        key: deviceId,
        value: JSON.stringify(message),
      }],
    });
  }

  /**
   * Makine durum degisikligi gonder (mes.telemetry.machine-status)
   */
  async publishMachineStatus(
    edgeId: string,
    deviceId: string,
    machineId: string,
    previousStatus: MachineStatus,
    currentStatus: MachineStatus,
    reason?: string,
  ) {
    if (!this.connected) return;

    const message = {
      edgeId,
      deviceId,
      machineId,
      timestamp: new Date().toISOString(),
      previousStatus,
      currentStatus,
      reason,
    };

    await this.producer.send({
      topic: TOPICS.MACHINE_STATUS,
      messages: [{
        key: deviceId,
        value: JSON.stringify(message),
      }],
    });
  }

  /**
   * Alarm event gonder (mes.telemetry.alarms)
   */
  async publishAlarm(
    edgeId: string,
    deviceId: string,
    severity: 'critical' | 'warning' | 'info',
    message: string,
    tagId?: string,
    triggerValue?: number,
    threshold?: number,
  ) {
    if (!this.connected) return;

    const event = {
      edgeId,
      deviceId,
      alarmRuleId: `SIM-${deviceId}-${tagId || 'general'}`,
      tagId: tagId || '',
      severity,
      triggerValue: triggerValue || 0,
      threshold: threshold || 0,
      message,
      timestamp: new Date().toISOString(),
    };

    await this.producer.send({
      topic: TOPICS.ALARMS,
      messages: [{
        key: deviceId,
        value: JSON.stringify(event),
      }],
    });
  }

  /**
   * Is emri durum degisikligi (mes.production.job-order-status)
   */
  async publishJobOrderStatus(
    jobOrderNo: string,
    status: string,
    machineId: string,
    quantityProduced: number,
    quantityPlanned: number,
    quantityScrapped: number,
    materialCode?: string,
    materialName?: string,
    operation?: string,
    customer?: string,
    phaseNo?: number,
  ) {
    if (!this.connected) return;

    const event = {
      jobOrderId: jobOrderNo,
      jobOrderNo,
      previousStatus: status === 'started' ? 'created' : 'started',
      currentStatus: status,
      changedBy: 'simulator',
      machineId,
      phaseNo: phaseNo || 1,
      quantityProduced,
      quantityPlanned,
      quantityScrapped,
      materialCode: materialCode || '',
      materialName: materialName || jobOrderNo,
      operation: operation || 'production',
      customer: customer || '',
      progress: quantityPlanned > 0 ? Math.round((quantityProduced / quantityPlanned) * 100) : 0,
      timestamp: new Date().toISOString(),
    };

    await this.producer.send({
      topic: 'mes.production.job-order-status',
      messages: [{
        key: jobOrderNo,
        value: JSON.stringify(event),
      }],
    });
  }

  /**
   * Malzeme tuketim event (mes.production.material-consumption)
   */
  async publishMaterialConsumption(
    jobOrderNo: string,
    machineId: string,
    materialCode: string,
    quantity: number,
    unit: string,
  ) {
    if (!this.connected) return;

    await this.producer.send({
      topic: 'mes.production.material-consumption',
      messages: [{
        key: jobOrderNo,
        value: JSON.stringify({
          jobOrderNo,
          machineId,
          materialCode,
          quantity,
          unit,
          timestamp: new Date().toISOString(),
        }),
      }],
    });
  }
}

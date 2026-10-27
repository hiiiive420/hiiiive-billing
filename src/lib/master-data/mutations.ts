import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/prisma";
import { normalizeInvoiceCurrencyCode } from "@/lib/invoices/currency";
import { MasterDataNotFoundError } from "./workspaces";

type TextField = string | null;
type ClientInput = { name: string; businessRegistrationOrTaxIdentifier: TextField; phone: TextField; email: TextField; billingAddress: TextField; notes: TextField; active: boolean };
type ContactInput = { name: string; email: TextField; phone: TextField; billingContact: boolean; primaryContact: boolean; active: boolean };
type ServiceInput = { name: string; description: TextField; defaultUnitPrice: Prisma.Decimal | null; currencyCode: string; active: boolean };

export class MasterDataValidationError extends Error {
  constructor(message: string) { super(message); this.name = "MasterDataValidationError"; }
}

function optionalText(input: Record<string, unknown>, key: string, max: number): string | null {
  const value = input[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new MasterDataValidationError(`${key} must be text.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new MasterDataValidationError(`${key} is too long.`);
  return normalized || null;
}

function requiredText(input: Record<string, unknown>, key: string, max: number): string {
  const value = input[key];
  if (typeof value !== "string") throw new MasterDataValidationError(`${key} is required.`);
  const normalized = value.trim();
  if (!normalized) throw new MasterDataValidationError(`${key} is required.`);
  if (normalized.length > max) throw new MasterDataValidationError(`${key} is too long.`);
  return normalized;
}

function optionalEmail(value: string | null): string | null {
  if (value === null) return null;
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new MasterDataValidationError("Enter a valid email address.");
  return value.toLowerCase();
}

function booleanField(input: Record<string, unknown>, key: string, defaultValue: boolean): boolean {
  const value = input[key];
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") throw new MasterDataValidationError(`${key} is invalid.`);
  return value;
}

export function parseClientInput(value: unknown): ClientInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MasterDataValidationError("Client details are invalid.");
  const input = value as Record<string, unknown>;
  return {
    name: requiredText(input, "name", 200),
    businessRegistrationOrTaxIdentifier: optionalText(input, "businessRegistrationOrTaxIdentifier", 200),
    phone: optionalText(input, "phone", 50),
    email: optionalEmail(optionalText(input, "email", 254)),
    billingAddress: optionalText(input, "billingAddress", 2000),
    notes: optionalText(input, "notes", 5000),
    active: booleanField(input, "active", true),
  };
}

export function parseContactInput(value: unknown): ContactInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MasterDataValidationError("Contact details are invalid.");
  const input = value as Record<string, unknown>;
  return {
    name: requiredText(input, "name", 200),
    email: optionalEmail(optionalText(input, "email", 254)),
    phone: optionalText(input, "phone", 50),
    billingContact: booleanField(input, "billingContact", false),
    primaryContact: booleanField(input, "primaryContact", false),
    active: booleanField(input, "active", true),
  };
}

export function parseServiceInput(value: unknown): ServiceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MasterDataValidationError("Service details are invalid.");
  const input = value as Record<string, unknown>;
  const rawPrice = input.defaultUnitPrice;
  let defaultUnitPrice: Prisma.Decimal | null = null;
  if (rawPrice !== undefined && rawPrice !== null && rawPrice !== "") {
    if (typeof rawPrice !== "string" || !/^\d{1,15}(?:\.\d{1,4})?$/.test(rawPrice)) throw new MasterDataValidationError("Default price must be nonnegative and support at most four decimal places.");
    defaultUnitPrice = new Prisma.Decimal(rawPrice);
  }
  const rawCurrency = input.currencyCode;
  if (typeof rawCurrency !== "string") throw new MasterDataValidationError("Currency code is invalid.");
  let currencyCode: string;
  try { currencyCode = normalizeInvoiceCurrencyCode(rawCurrency); }
  catch { throw new MasterDataValidationError("Currency code must contain three letters."); }
  return {
    name: requiredText(input, "name", 200),
    description: optionalText(input, "description", 2000),
    defaultUnitPrice,
    currencyCode,
    active: booleanField(input, "active", true),
  };
}

export async function createClient(organizationId: string, input: unknown) {
  const data = parseClientInput(input);
  return getPrismaClient().client.create({ data: { organizationId, ...data }, select: { id: true } });
}

export async function updateClient(organizationId: string, clientId: string, input: unknown) {
  const data = parseClientInput(input);
  const result = await getPrismaClient().client.updateMany({ where: { organizationId, id: clientId }, data });
  if (result.count !== 1) throw new MasterDataNotFoundError();
}

export async function createClientContact(organizationId: string, clientId: string, input: unknown) {
  const data = parseContactInput(input);
  const prisma = getPrismaClient();
  const clientExists = await prisma.client.count({ where: { organizationId, id: clientId } });
  if (!clientExists) throw new MasterDataNotFoundError();
  return prisma.clientContact.create({ data: { organizationId, clientId, ...data }, select: { id: true } });
}

export async function updateClientContact(organizationId: string, clientId: string, contactId: string, input: unknown) {
  const data = parseContactInput(input);
  const result = await getPrismaClient().clientContact.updateMany({ where: { organizationId, clientId, id: contactId }, data });
  if (result.count !== 1) throw new MasterDataNotFoundError();
}

export async function createService(organizationId: string, input: unknown) {
  const data = parseServiceInput(input);
  return getPrismaClient().service.create({ data: { organizationId, ...data }, select: { id: true } });
}

export async function updateService(organizationId: string, serviceId: string, input: unknown) {
  const data = parseServiceInput(input);
  const result = await getPrismaClient().service.updateMany({ where: { organizationId, id: serviceId }, data });
  if (result.count !== 1) throw new MasterDataNotFoundError();
}

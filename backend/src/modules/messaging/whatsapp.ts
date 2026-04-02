import { config } from '../../config';

interface WhatsAppMessage {
  to: string;
  templateName: string;
  templateParams: string[];
}

interface WhatsAppTextMessage {
  to: string;
  text: string;
}

export async function sendWhatsAppTemplate(message: WhatsAppMessage): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
  response?: any;
}> {
  const { apiUrl, phoneNumberId, accessToken } = config.whatsapp;

  if (!phoneNumberId || !accessToken) {
    return {
      success: false,
      error: 'WhatsApp not configured: missing phone number ID or access token',
    };
  }

  try {
    const url = `${apiUrl}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'template',
      template: {
        name: message.templateName,
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: message.templateParams.map((param) => ({
              type: 'text',
              text: param,
            })),
          },
        ],
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (response.ok) {
      return {
        success: true,
        messageId: data.messages?.[0]?.id,
        response: data,
      };
    }

    return {
      success: false,
      error: data.error?.message || 'WhatsApp API error',
      response: data,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to send WhatsApp message',
    };
  }
}

export async function sendWhatsAppText(message: WhatsAppTextMessage): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
  response?: any;
}> {
  const { apiUrl, phoneNumberId, accessToken } = config.whatsapp;

  if (!phoneNumberId || !accessToken) {
    return {
      success: false,
      error: 'WhatsApp not configured: missing phone number ID or access token',
    };
  }

  try {
    const url = `${apiUrl}/${phoneNumberId}/messages`;
    const body = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'text',
      text: { body: message.text },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (response.ok) {
      return {
        success: true,
        messageId: data.messages?.[0]?.id,
        response: data,
      };
    }

    return {
      success: false,
      error: data.error?.message || 'WhatsApp API error',
      response: data,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Failed to send WhatsApp message',
    };
  }
}

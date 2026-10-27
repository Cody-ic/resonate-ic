import ipaddr from "ipaddr.js";

export const loginWindowSeconds = 60;
export const loginAccountMax = 8;
export const loginIpMax = 600;

// CF-Connecting-IP is trusted only behind Cloudflare or an origin proxy that
// overwrites client-supplied identity headers. Never inspect email/SSID/city.
export function trustedCampusLogin(headers: Headers, cidrs = "") {
    const value = headers.get("cf-connecting-ip");
    if (!value || !cidrs || value.includes("%")) return false;
    try {
        const address = ipaddr.process(value);
        return cidrs.split(/[\s,]+/).filter(Boolean).some(entry => {
            try {
                const [network, prefix] = ipaddr.parseCIDR(entry.includes("/") ? entry : `${entry}/${ipaddr.parse(entry).kind() === "ipv4" ? 32 : 128}`);
                // Do not turn an accidental catch-all into a campus exemption.
                return prefix > 0 && address.kind() === network.kind() && address.match(network, prefix);
            } catch { return false; }
        });
    } catch { return false; }
}

export async function loginAccountLimitKey(email: string, secret: string) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const hash = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(email.trim().toLowerCase()));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

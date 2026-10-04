import { hashPassword } from "./access-gateway.mjs";

// Read from stdin: password arguments would be visible in process listings.
let password = "";
for await (const chunk of process.stdin) {
  password += chunk.toString("utf8");
  if (Buffer.byteLength(password, "utf8") > 2048)
    throw new Error("Password input is too large");
}
password = password.replace(/\r?\n$/, "");
console.log(await hashPassword(password));

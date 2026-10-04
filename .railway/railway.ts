import {
  defineRailway,
  github,
  preserve,
  project,
  service,
  volume,
} from "railway/iac";

export default defineRailway(() => {
  const thursdayVolume = volume("thursday-volume", {
    alerts: { usage: { "100": {}, "80": {}, "95": {} } },
    allowOnlineResize: true,
    region: "sfo",
    sizeMB: 5000,
  });
  const thursday = service("thursday", {
    source: github("deestudio028-droid/Thrusday", { branch: "main" }),
    build: { builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 300,
      sleepApplication: false,
      restartPolicyType: "ALWAYS",
    },
    replicas: { sfo: 1 },
    volumeMounts: { "/app/data": thursdayVolume },
    env: {
      APP_PASSWORD_HASH: preserve(),
      APP_PUBLIC_ORIGIN: preserve(),
      INTERNAL_PORT: preserve(),
      PORT: preserve(),
      SESSION_SECRET: preserve(),
    },
  });

  return project("Thrusday", {
    resources: [thursday, thursdayVolume],
  });
});

output "app_name" {
  description = "What deploy-staging.yml links to, by name, inside the staging organisation."
  value       = clevercloud_nodejs.staging.name
}

output "url" {
  description = "Where staging answers. The smoke test and, later, UptimeRobot (INF-08) watch this."
  value       = "https://trygghverdag-staging.cleverapps.io"
}

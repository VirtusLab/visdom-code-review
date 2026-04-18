FROM grafana/grafana:11.5.0

COPY provisioning /etc/grafana/provisioning
# Copy dashboards to /etc (not /var/lib/grafana) so the volume mount doesn't shadow them
COPY dashboards /etc/grafana-dashboards

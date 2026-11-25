# Road-matching service for Field Duty routes (OSRM + OpenStreetMap). Deployed as its OWN Railway service
# (root directory: osrm). Nothing leaves your infrastructure: the app talks to it over Railway's private network.
#
# Regions: build argument PBF_URLS = one or more Geofabrik extracts separated by spaces; several are merged into one road graph.
# Default = northern zone (Delhi NCR, UP, Haryana, Punjab, Rajasthan...) + central zone (Madhya Pradesh incl. Indore/Ujjain, Chhattisgarh).
# Whole-India extracts are too slow for Railway's build time limit (tried: the build was cut off); keep to the zones you operate in.
# Other zones: western-zone, southern-zone, eastern-zone, north-eastern-zone.
FROM alpine:3.20 AS download
ARG PBF_URLS="https://download.geofabrik.de/asia/india/northern-zone-latest.osm.pbf https://download.geofabrik.de/asia/india/central-zone-latest.osm.pbf"
RUN apk add --no-cache wget ca-certificates osmium-tool
RUN set -e; i=0; for u in $PBF_URLS; do i=$((i+1)); wget -q -O /part$i.osm.pbf "$u"; done; \
    if [ "$i" -gt 1 ]; then osmium merge /part*.osm.pbf -o /region.osm.pbf; else mv /part1.osm.pbf /region.osm.pbf; fi; \
    rm -f /part*.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1 AS prepare
COPY --from=download /region.osm.pbf /data/region.osm.pbf
RUN osrm-extract -p /opt/car.lua /data/region.osm.pbf \
 && osrm-partition /data/region.osrm \
 && osrm-customize /data/region.osrm \
 && rm /data/region.osm.pbf

FROM ghcr.io/project-osrm/osrm-backend:v5.27.1
COPY --from=prepare /data /data
EXPOSE 5000
CMD ["osrm-routed", "--algorithm", "mld", "--max-matching-size", "200", "--port", "5000", "/data/region.osrm"]

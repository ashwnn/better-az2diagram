# Kusto queries run against Azure Resource Graph. They only read.
$script:KqlResources = "Resources | project id, name, type, location, resourceGroup, subscriptionId, tags, properties, sku, kind, identity, managedBy | order by id asc"
$script:KqlContainers = "ResourceContainers | where type in~ ('microsoft.resources/subscriptions', 'microsoft.resources/subscriptions/resourcegroups') | project id, name, type, location, subscriptionId, resourceGroup, tags, properties | order by id asc"
$script:KqlRoles = "AuthorizationResources | where type =~ 'microsoft.authorization/roleassignments' | where tostring(properties.principalType) =~ 'ServicePrincipal' | project id, properties | order by id asc"
$script:PageSize = 1000
$script:GuidPattern = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
